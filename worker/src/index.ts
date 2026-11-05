import { renderInstallPage, renderErrorPage, renderSharePage } from "./page";
import type { Recipe } from "./util";
import {
  byteLength,
  countSteps,
  generateId,
  isValidId,
  isAndroid,
  timingSafeEqual,
  validateRecipeInput,
} from "./util";

export interface Env {
  RECIPES: KVNamespace;
  APP_KEY?: string;
  ASSETLINKS_JSON?: string;
  APK_URL?: string;
  VERSION_JSON?: string;
  SITE_NAME?: string;
}

const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; " +
  "script-src 'self'; base-uri 'none'; form-action 'none'";

const BASE_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

const IDEMPOTENCY_TTL_SECONDS = 86400;
const TOMBSTONE_TTL_SECONDS = 30 * 24 * 60 * 60;

// Upper bound for the raw request body (the validator enforces the tighter
// per-field limits) and for the serialized KV value.
const MAX_REQUEST_BYTES = 200_000;
const MAX_STORED_BYTES = 100 * 1024;

const DEFAULT_VERSION = {
  versionCode: 1,
  versionName: "1.0.0",
  url: "",
  notes: "",
};

const PAGE_JS = `(function () {
  "use strict";
  var button = document.getElementById("copy");
  var status = document.getElementById("copy-status");
  if (!button) return;

  function setStatus(message) {
    if (status) status.textContent = message;
  }

  function legacyCopy(text) {
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-2000px";
    area.style.left = "-2000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (error) {
      ok = false;
    }
    document.body.removeChild(area);
    return ok;
  }

  button.addEventListener("click", function () {
    var text = button.getAttribute("data-copy") || "";
    if (!text) {
      setStatus("Nada para copiar.");
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        setStatus("Receita copiada!");
        button.textContent = "Copiado!";
        window.setTimeout(function () {
          button.textContent = "Copiar receita";
        }, 2000);
      }, function () {
        setStatus(legacyCopy(text) ? "Receita copiada!" : "Selecione o texto e copie manualmente.");
      });
    } else {
      setStatus(legacyCopy(text) ? "Receita copiada!" : "Selecione o texto e copie manualmente.");
    }
  });
})();
`;

function jsonResponse(
  data: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  const headers = new Headers(BASE_HEADERS);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return new Response(JSON.stringify(data), { status, headers });
}

function htmlResponse(
  html: string,
  status: number,
  cacheControl: string,
  extra: Record<string, string> = {},
): Response {
  const headers = new Headers(BASE_HEADERS);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Content-Security-Policy", CSP);
  headers.set("Cache-Control", cacheControl);
  headers.set("X-Robots-Tag", "noindex, nofollow");
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return new Response(html, { status, headers });
}

function textResponse(
  text: string,
  status = 200,
  cacheControl = "no-store",
): Response {
  const headers = new Headers(BASE_HEADERS);
  headers.set("Content-Type", "text/plain; charset=utf-8");
  headers.set("Cache-Control", cacheControl);
  return new Response(text, { status, headers });
}

function isAuthorized(request: Request, env: Env): boolean {
  const expected = env.APP_KEY ?? "";
  const provided = request.headers.get("X-App-Key") ?? "";
  if (!expected || !provided) return false;
  return timingSafeEqual(provided, expected);
}

type Lookup =
  | { kind: "ok"; recipe: Recipe }
  | { kind: "revoked" }
  | { kind: "missing" };

function normalizeRecipe(value: unknown, id: string): Recipe | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.title !== "string" || typeof record.body !== "string") {
    return null;
  }
  const title = record.title;
  const body = record.body;
  const stepCount =
    typeof record.stepCount === "number" && Number.isFinite(record.stepCount)
      ? record.stepCount
      : countSteps(body);
  const sender = typeof record.sender === "string" ? record.sender : "";
  const createdAt =
    typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
      ? record.createdAt
      : 0;

  return {
    // Always trust the KV key over the embedded id so the canonical URL,
    // lookup path, and JSON payload cannot disagree.
    id,
    v: 1,
    title,
    body,
    stepCount,
    sender,
    createdAt,
  };
}

async function lookupRecipe(env: Env, id: string): Promise<Lookup> {
  if (!isValidId(id)) return { kind: "missing" };

  const [tombstone, raw] = await Promise.all([
    env.RECIPES.get(`tomb:${id}`),
    env.RECIPES.get(`r:${id}`),
  ]);

  if (tombstone) return { kind: "revoked" };
  if (!raw) return { kind: "missing" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "missing" };
  }

  const recipe = normalizeRecipe(parsed, id);
  if (!recipe) return { kind: "missing" };
  return { kind: "ok", recipe };
}

type RecipeDraft = Omit<Recipe, "id" | "v" | "stepCount" | "createdAt">;

type BodyParse =
  | { ok: true; value: RecipeDraft }
  | { ok: false; status: 400 | 413 };

/**
 * Read and validate a create/update body. Mirrors the original POST rules:
 * oversized requests are 413, malformed JSON or shapes are 400.
 */
async function parseRecipeBody(request: Request): Promise<BodyParse> {
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_REQUEST_BYTES
  ) {
    return { ok: false, status: 413 };
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return { ok: false, status: 400 };
  }

  if (byteLength(rawBody) > MAX_REQUEST_BYTES) {
    return { ok: false, status: 413 };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400 };
  }

  const result = validateRecipeInput(parsed);
  if (!result.ok) return { ok: false, status: result.status };
  return { ok: true, value: result.value };
}

function bodyErrorResponse(status: 400 | 413): Response {
  return jsonResponse(
    { error: status === 413 ? "too_large" : "invalid" },
    status,
  );
}

function isStorable(recipe: Recipe): boolean {
  return byteLength(JSON.stringify(recipe)) <= MAX_STORED_BYTES;
}

async function handleCreate(
  request: Request,
  env: Env,
  origin: string,
): Promise<Response> {
  if (!isAuthorized(request, env)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const idempotencyKey = request.headers.get("X-Idempotency-Key");
  if (idempotencyKey && idempotencyKey.length > 128) {
    return jsonResponse({ error: "invalid" }, 400);
  }

  if (idempotencyKey) {
    const existingId = await env.RECIPES.get(`idem:${idempotencyKey}`);
    if (existingId && isValidId(existingId)) {
      const existing = await env.RECIPES.get(`r:${existingId}`);
      if (existing) {
        return jsonResponse(
          { id: existingId, url: `${origin}/r/${existingId}` },
          201,
        );
      }
    }
  }

  const parsed = await parseRecipeBody(request);
  if (!parsed.ok) return bodyErrorResponse(parsed.status);

  const id = generateId();
  const recipe: Recipe = {
    id,
    v: 1,
    title: parsed.value.title,
    body: parsed.value.body,
    stepCount: countSteps(parsed.value.body),
    sender: parsed.value.sender,
    createdAt: Date.now(),
  };

  if (!isStorable(recipe)) {
    return jsonResponse({ error: "too_large" }, 413);
  }

  const serialized = JSON.stringify(recipe);
  await env.RECIPES.put(`r:${id}`, serialized);

  if (idempotencyKey) {
    try {
      await env.RECIPES.put(`idem:${idempotencyKey}`, id, {
        expirationTtl: IDEMPOTENCY_TTL_SECONDS,
      });
    } catch (error) {
      // The recipe is safely stored; idempotency is best-effort.
      console.error("failed to store idempotency key", error);
    }
  }

  return jsonResponse({ id, url: `${origin}/r/${id}` }, 201);
}

async function handleUpdate(
  request: Request,
  env: Env,
  id: string,
  origin: string,
): Promise<Response> {
  if (!isAuthorized(request, env)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  // Reuse the GET lookup so invalid ids, tombstones, missing values, and
  // unparseable stored JSON all keep their existing status codes. In
  // particular, an unparseable value is treated as not_found, not overwritten.
  const lookup = await lookupRecipe(env, id);
  if (lookup.kind === "revoked") {
    return jsonResponse({ error: "revoked" }, 410);
  }
  if (lookup.kind === "missing") {
    return jsonResponse({ error: "not_found" }, 404);
  }

  const parsed = await parseRecipeBody(request);
  if (!parsed.ok) return bodyErrorResponse(parsed.status);

  const recipe: Recipe = {
    ...lookup.recipe,
    title: parsed.value.title,
    body: parsed.value.body,
    stepCount: countSteps(parsed.value.body),
    sender: parsed.value.sender,
  };

  if (!isStorable(recipe)) {
    return jsonResponse({ error: "too_large" }, 413);
  }

  await env.RECIPES.put(`r:${id}`, JSON.stringify(recipe));

  return jsonResponse({ id, url: `${origin}/r/${id}` }, 200);
}

async function handleGetJson(env: Env, id: string): Promise<Response> {
  const lookup = await lookupRecipe(env, id);
  if (lookup.kind === "revoked") {
    return jsonResponse({ error: "revoked" }, 410);
  }
  if (lookup.kind === "missing") {
    return jsonResponse({ error: "not_found" }, 404);
  }
  return jsonResponse(lookup.recipe, 200);
}

async function handleDelete(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  if (!isAuthorized(request, env)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  if (isValidId(id)) {
    await env.RECIPES.delete(`r:${id}`);
    await env.RECIPES.put(
      `tomb:${id}`,
      JSON.stringify({ id, revokedAt: Date.now() }),
      { expirationTtl: TOMBSTONE_TTL_SECONDS },
    );
  }

  return new Response(null, { status: 204, headers: BASE_HEADERS });
}

async function handleSharePage(
  request: Request,
  env: Env,
  id: string,
  origin: string,
): Promise<Response> {
  const lookup = await lookupRecipe(env, id);

  if (lookup.kind !== "ok") {
    const status = lookup.kind === "revoked" ? 410 : 404;
    return htmlResponse(
      renderErrorPage(status, origin),
      status,
      "no-store",
    );
  }

  const html = renderSharePage(lookup.recipe, {
    origin,
    android: isAndroid(request.headers.get("User-Agent")),
    apkAvailable: apkConfigured(env),
  });

  return htmlResponse(html, 200, "private, max-age=300", {
    Vary: "User-Agent",
  });
}

function handleAssetLinks(env: Env): Response {
  const raw = env.ASSETLINKS_JSON ?? "";
  let valid = false;
  try {
    JSON.parse(raw);
    valid = true;
  } catch {
    valid = false;
  }

  if (!valid) {
    return jsonResponse({ error: "server_error" }, 500);
  }

  const headers = new Headers(BASE_HEADERS);
  headers.set("Content-Type", "application/json");
  headers.set("Cache-Control", "public, max-age=3600");
  return new Response(raw, { headers });
}

function handleVersion(env: Env): Response {
  let value: unknown = DEFAULT_VERSION;
  if (env.VERSION_JSON) {
    try {
      const parsed: unknown = JSON.parse(env.VERSION_JSON);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        value = parsed;
      }
    } catch {
      value = DEFAULT_VERSION;
    }
  }

  // Short cache so a release propagates fast; the payload is tiny.
  return jsonResponse(value, 200, { "Cache-Control": "public, max-age=60" });
}

function handleApk(env: Env): Response {
  const target = (env.APK_URL ?? "").trim();
  if (!target) {
    return textResponse("APK não disponível.\n", 404);
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return textResponse("APK indisponível.\n", 404);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return textResponse("APK indisponível.\n", 404);
  }

  return Response.redirect(parsed.toString(), 302);
}

function apkConfigured(env: Env): boolean {
  const target = (env.APK_URL ?? "").trim();
  if (!target) return false;
  try {
    const parsed = new URL(target);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function handleRoot(env: Env): Response {
  return htmlResponse(
    renderInstallPage({
      siteName: env.SITE_NAME ?? "My Recipes",
      apkAvailable: apkConfigured(env),
    }),
    200,
    "public, max-age=300",
  );
}

async function handleRoute(
  request: Request,
  env: Env,
  url: URL,
  path: string,
  method: string,
): Promise<Response> {
  if (path === "/api/recipes" && method === "POST") {
    return await handleCreate(request, env, url.origin);
  }

  const apiMatch = /^\/api\/recipes\/([^/]+)$/.exec(path);
  if (apiMatch) {
    let id = apiMatch[1] ?? "";
    try {
      id = decodeURIComponent(id);
    } catch {
      // Keep the malformed value; lookup will return not_found.
    }
    if (method === "GET") return await handleGetJson(env, id);
    if (method === "PUT") return await handleUpdate(request, env, id, url.origin);
    if (method === "DELETE") return await handleDelete(request, env, id);
  }

  const shareMatch = /^\/r\/([^/]+)$/.exec(path);
  if (shareMatch && method === "GET") {
    let id = shareMatch[1] ?? "";
    try {
      id = decodeURIComponent(id);
    } catch {
      // Keep the malformed value; lookup will return not_found.
    }
    return await handleSharePage(request, env, id, url.origin);
  }

  if (path === "/.well-known/assetlinks.json" && method === "GET") {
    return handleAssetLinks(env);
  }

  if (path === "/app/version.json" && method === "GET") {
    return handleVersion(env);
  }

  if (path === "/app/latest.apk" && method === "GET") {
    return handleApk(env);
  }

  if (path === "/assets/page.js" && method === "GET") {
    const headers = new Headers(BASE_HEADERS);
    headers.set("Content-Type", "application/javascript");
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    return new Response(PAGE_JS, { headers });
  }

  if (path === "/" && method === "GET") {
    return handleRoot(env);
  }

  if (path === "/robots.txt" && method === "GET") {
    return textResponse("User-agent: *\nDisallow: /\n", 200, "public, max-age=3600");
  }

  return htmlResponse(renderErrorPage(404, url.origin), 404, "no-store");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // `.boo` is HSTS-preloaded and the Worker is TLS-only. Upgrade here as well
    // so a plain-HTTP request never receives a 200. Cloudflare reports the
    // original scheme in X-Forwarded-Proto; local `wrangler dev` omits it.
    if (request.headers.get("X-Forwarded-Proto") === "http") {
      const secure = `https://${url.host}${url.pathname}${url.search}`;
      return Response.redirect(secure, 301);
    }

    const isHead = request.method.toUpperCase() === "HEAD";
    const method = isHead ? "GET" : request.method.toUpperCase();

    let response: Response;
    try {
      response = await handleRoute(request, env, url, url.pathname, method);
    } catch (error) {
      console.error("unhandled request error", error);
      response = htmlResponse(renderErrorPage(500, url.origin), 500, "no-store");
    }

    if (!isHead) return response;
    return new Response(null, {
      status: response.status,
      headers: response.headers,
    });
  },
} satisfies ExportedHandler<Env>;
