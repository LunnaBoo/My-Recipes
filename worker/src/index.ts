import { renderInstallPage, renderErrorPage, renderSharePage } from "./page";
import type { Recipe, SenderSeal } from "./util";
import {
  byteLength,
  charLength,
  countSteps,
  generateId,
  isValidId,
  isAndroid,
  timingSafeEqual,
  validateRecipeInput,
  validateSeal,
} from "./util";
import { hashSecret, isValidSecret } from "./mailbox";
import type { Letter, MailboxProfile } from "./mailbox";

export { RateLimiter } from "./rateLimiter";
export { Mailbox } from "./mailbox";

export interface Env {
  RECIPES: KVNamespace;
  RATE_LIMITER: DurableObjectNamespace;
  MAILBOXES: DurableObjectNamespace;
  APP_KEY?: string;
  ASSETLINKS_JSON?: string;
  APK_URL?: string;
  VERSION_JSON?: string;
  SITE_NAME?: string;
}

const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; " +
  "script-src 'self'; base-uri 'none'; form-action 'none'; " +
  "frame-ancestors 'none'";

const BASE_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

const IDEMPOTENCY_TTL_SECONDS = 86400;
const TOMBSTONE_TTL_SECONDS = 30 * 24 * 60 * 60;

// Send retries are keyed by the client's X-Idempotency-Key. The stored value
// keeps the letter plus the recipient address so a retry can answer without
// writing a second letter (MAILBOX.md §6.2).
const MAILBOX_IDEM_PREFIX = "idem:letter:";

// Upper bound for the raw request body (the validator enforces the tighter
// per-field limits) and for the serialized KV value.
const MAX_REQUEST_BYTES = 200_000;
// 64 KB body + ~43 KB base64 seal + metadata still fit comfortably.
const MAX_STORED_BYTES = 128 * 1024;

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

// Local `wrangler dev` and the smoke tests do not present a real client IP.
const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * Enforce the write budget (20 writes/hour/IP) before doing any KV work.
 * Returns a ready 429 response when the caller is over budget, else null.
 * Requests without a usable client IP (local dev, tests) are not limited.
 */
async function checkWriteRateLimit(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip || LOOPBACK_IPS.has(ip)) return null;

  const stub = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(ip));
  const response = await stub.fetch("https://rate-limit/check");
  if (response.status !== 429) return null;

  const retryAfter = response.headers.get("Retry-After") ?? "60";
  return jsonResponse({ error: "rate_limited" }, 429, {
    "Retry-After": retryAfter,
  });
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

  // Re-validate the seal on read. A legacy or malformed value in KV degrades
  // to "no seal" (and therefore the default star) instead of breaking the page.
  const seal = validateSeal(record.senderSeal);
  const senderSeal = seal.ok ? seal.value : undefined;

  return {
    // Always trust the KV key over the embedded id so the canonical URL,
    // lookup path, and JSON payload cannot disagree.
    id,
    v: 1,
    title,
    body,
    stepCount,
    sender,
    senderSeal,
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
 * Read the request body without ever buffering more than `max` bytes.
 * `Content-Length` is checked first, but a chunked request can omit it; the
 * streaming cap keeps a hostile body from filling the isolate's memory.
 * Returns null when the body exceeds the cap or cannot be read.
 */
async function readTextCapped(
  request: Request,
  max: number,
): Promise<string | null> {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }

    return text + decoder.decode();
  } catch {
    await reader.cancel().catch(() => {});
    return null;
  }
}

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

  const rawBody = await readTextCapped(request, MAX_REQUEST_BYTES);
  if (rawBody === null) {
    return { ok: false, status: 413 };
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

  const limited = await checkWriteRateLimit(request, env);
  if (limited) return limited;

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
    senderSeal: parsed.value.senderSeal,
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
    senderSeal: parsed.value.senderSeal,
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

/* ------------------------------------------------------------------ *
 * Mailboxes (MAILBOX.md §6). One Durable Object per address; the DO
 * stores only `{ id, shareId, sentAt }` per letter and the display
 * fields are joined from `r:<shareId>` here, for the owner only.
 * ------------------------------------------------------------------ */

type JsonBody =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; status: 400 | 413 };

type LetterView = Letter & {
  title?: string;
  stepCount?: number;
  sender?: string;
  senderSeal?: SenderSeal;
  available: boolean;
};

type ProfileParse =
  | { ok: true; name: string; seal: SenderSeal | null }
  | { ok: false; status: 400 | 413 };

function mailboxStub(env: Env, address: string): DurableObjectStub {
  return env.MAILBOXES.get(env.MAILBOXES.idFromName(`mailbox:${address}`));
}

/** `Authorization: Bearer <secret>` — the mailbox owner token. */
function bearerSecret(request: Request): string {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer[ \t]+(\S+)$/i.exec(header);
  return match?.[1] ?? "";
}

async function readJsonBody(request: Request): Promise<JsonBody> {
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return { ok: false, status: 413 };
  }
  const raw = await readTextCapped(request, MAX_REQUEST_BYTES);
  if (raw === null || byteLength(raw) > MAX_REQUEST_BYTES) {
    return { ok: false, status: 413 };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400 };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, status: 400 };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

function isStoredLetter(value: unknown): value is Letter {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.shareId === "string" &&
    typeof record.sentAt === "number"
  );
}

function parseMailboxProfile(value: Record<string, unknown>): ProfileParse {
  if (typeof value.name !== "string") return { ok: false, status: 400 };
  const name = value.name.trim();
  if (charLength(name) > 40) return { ok: false, status: 400 };

  const seal = validateSeal(value.seal);
  if (!seal.ok) return { ok: false, status: seal.status };

  return { ok: true, name, seal: seal.value ?? null };
}

/** Public projection of a mailbox: name and seal, never the secret hash. */
async function readMailboxProfile(
  env: Env,
  address: string,
): Promise<MailboxProfile | null> {
  const response = await mailboxStub(env, address).fetch("https://mailbox/meta");
  if (response.status !== 200) return null;

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;

  const record = parsed as Record<string, unknown>;
  if (typeof record.name !== "string") return null;
  const seal = validateSeal(record.seal);
  return { name: record.name, seal: seal.ok ? (seal.value ?? null) : null };
}

/**
 * Owner gate for the recipient's own routes. Returns a ready response when the
 * request is not allowed, else null. A missing mailbox is 404; a wrong secret
 * is 401, so the app can tell the two apart.
 */
async function requireOwner(
  request: Request,
  env: Env,
  address: string,
): Promise<Response | null> {
  if (!isValidId(address)) return jsonResponse({ error: "not_found" }, 404);

  const secret = bearerSecret(request);
  if (!isValidSecret(secret)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const stub = mailboxStub(env, address);
  const meta = await stub.fetch("https://mailbox/meta");
  if (meta.status === 404) return jsonResponse({ error: "not_found" }, 404);
  if (meta.status !== 200) {
    return jsonResponse({ error: "server_error" }, 500);
  }

  const verified = await stub.fetch("https://mailbox/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret }),
  });
  if (verified.status === 200) return null;
  return jsonResponse({ error: "unauthorized" }, 401);
}

/**
 * Add the display fields the recipient sees. The stored letter stays
 * `{ id, shareId, sentAt }`; a missing or revoked share is simply
 * `available: false` with no display fields (the app keeps its cache).
 */
async function joinLetter(env: Env, letter: Letter): Promise<LetterView> {
  const lookup = await lookupRecipe(env, letter.shareId);
  if (lookup.kind !== "ok") {
    return {
      id: letter.id,
      shareId: letter.shareId,
      sentAt: letter.sentAt,
      available: false,
    };
  }
  return {
    id: letter.id,
    shareId: letter.shareId,
    sentAt: letter.sentAt,
    title: lookup.recipe.title,
    stepCount: lookup.recipe.stepCount,
    sender: lookup.recipe.sender,
    senderSeal: lookup.recipe.senderSeal,
    available: true,
  };
}

async function handleMailboxCreate(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!isAuthorized(request, env)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const limited = await checkWriteRateLimit(request, env);
  if (limited) return limited;

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return bodyErrorResponse(parsed.status);
  const body = parsed.value;

  const address = body.address;
  if (typeof address !== "string" || !isValidId(address)) {
    return jsonResponse({ error: "invalid" }, 400);
  }

  const secret = body.secret;
  if (typeof secret !== "string" || !isValidSecret(secret)) {
    return jsonResponse({ error: "invalid" }, 400);
  }

  const profile = parseMailboxProfile(body);
  if (!profile.ok) return bodyErrorResponse(profile.status);

  const secretHash = await hashSecret(secret);
  const stub = mailboxStub(env, address);
  const created = await stub.fetch("https://mailbox/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address,
      secretHash,
      name: profile.name,
      seal: profile.seal,
    }),
  });

  if (created.status === 201) return jsonResponse({ address }, 201);

  if (created.status === 409) {
    // Same address + same secret hash is an idempotent retry. A different
    // secret means the address is taken; the app retries with a new one.
    const verified = await stub.fetch("https://mailbox/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    });
    if (verified.status === 200) return jsonResponse({ address }, 200);
    return jsonResponse({ error: "address_taken" }, 409);
  }

  return jsonResponse({ error: "server_error" }, 500);
}

async function handleMailboxProfile(
  env: Env,
  address: string,
): Promise<Response> {
  if (!isValidId(address)) return jsonResponse({ error: "not_found" }, 404);
  const profile = await readMailboxProfile(env, address);
  if (!profile) return jsonResponse({ error: "not_found" }, 404);
  return jsonResponse(profile, 200);
}

async function handleMailboxUpdate(
  request: Request,
  env: Env,
  address: string,
): Promise<Response> {
  const denied = await requireOwner(request, env, address);
  if (denied) return denied;

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return bodyErrorResponse(parsed.status);

  const profile = parseMailboxProfile(parsed.value);
  if (!profile.ok) return bodyErrorResponse(profile.status);

  const response = await mailboxStub(env, address).fetch("https://mailbox/meta", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: profile.name, seal: profile.seal }),
  });
  if (response.status !== 200) {
    return jsonResponse({ error: "server_error" }, 500);
  }

  return jsonResponse({ address, name: profile.name, seal: profile.seal }, 200);
}

async function handleMailboxPush(
  request: Request,
  env: Env,
  address: string,
): Promise<Response> {
  const denied = await requireOwner(request, env, address);
  if (denied) return denied;

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return bodyErrorResponse(parsed.status);

  const token =
    typeof parsed.value.token === "string" ? parsed.value.token.trim() : "";
  if (token.length < 1 || token.length > 512) {
    return jsonResponse({ error: "invalid" }, 400);
  }
  const platform =
    typeof parsed.value.platform === "string"
      ? parsed.value.platform.trim()
      : "";
  if (platform.length < 1 || platform.length > 32) {
    return jsonResponse({ error: "invalid" }, 400);
  }

  const response = await mailboxStub(env, address).fetch("https://mailbox/push", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, platform }),
  });
  if (response.status !== 204) {
    return jsonResponse({ error: "server_error" }, 500);
  }

  return new Response(null, { status: 204, headers: BASE_HEADERS });
}

async function handleMailboxList(
  request: Request,
  env: Env,
  url: URL,
  address: string,
): Promise<Response> {
  const denied = await requireOwner(request, env, address);
  if (denied) return denied;

  const params = new URLSearchParams();
  const before = url.searchParams.get("before");
  if (before) params.set("before", before);
  const limit = url.searchParams.get("limit");
  if (limit) params.set("limit", limit);
  const query = params.toString();

  const response = await mailboxStub(env, address).fetch(
    `https://mailbox/letters${query ? `?${query}` : ""}`,
  );
  if (response.status !== 200) {
    return jsonResponse({ error: "server_error" }, 500);
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return jsonResponse({ error: "server_error" }, 500);
  }
  if (parsed === null || typeof parsed !== "object") {
    return jsonResponse({ error: "server_error" }, 500);
  }

  const stored = (parsed as Record<string, unknown>).letters;
  const letters = Array.isArray(stored) ? stored.filter(isStoredLetter) : [];
  const views = await Promise.all(
    letters.map((letter) => joinLetter(env, letter)),
  );

  return jsonResponse({ letters: views }, 200);
}

function parseIdemLetter(
  raw: string | null,
): { address: string; letter: Letter } | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;

  const record = parsed as Record<string, unknown>;
  if (typeof record.address !== "string" || !isStoredLetter(record.letter)) {
    return null;
  }
  return { address: record.address, letter: record.letter };
}

async function readAppendedLetter(response: Response): Promise<Letter | null> {
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const letter = (parsed as Record<string, unknown>).letter;
  return isStoredLetter(letter) ? letter : null;
}

async function handleMailboxSend(
  request: Request,
  env: Env,
  address: string,
): Promise<Response> {
  if (!isAuthorized(request, env)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const limited = await checkWriteRateLimit(request, env);
  if (limited) return limited;

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return bodyErrorResponse(parsed.status);
  const body = parsed.value;

  const shareId = body.shareId;
  if (typeof shareId !== "string" || !isValidId(shareId)) {
    return jsonResponse({ error: "invalid" }, 400);
  }

  const senderAddress = body.senderAddress;
  if (typeof senderAddress !== "string" || !isValidId(senderAddress)) {
    return jsonResponse({ error: "invalid" }, 400);
  }

  const idempotencyKey = request.headers.get("X-Idempotency-Key") ?? "";
  if (idempotencyKey.length > 128) {
    return jsonResponse({ error: "invalid" }, 400);
  }

  // The sender proves ownership of `senderAddress` with their own secret. The
  // app key alone is not enough to spoof a sender.
  const secret = bearerSecret(request);
  if (!isValidSecret(secret)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const senderStub = mailboxStub(env, senderAddress);
  const senderMeta = await senderStub.fetch("https://mailbox/meta");
  if (senderMeta.status === 404) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  if (senderMeta.status !== 200) {
    return jsonResponse({ error: "server_error" }, 500);
  }
  const senderVerified = await senderStub.fetch("https://mailbox/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret }),
  });
  if (senderVerified.status !== 200) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  // A retry with the same key returns the letter the first attempt created.
  if (idempotencyKey) {
    const stored = await env.RECIPES.get(
      `${MAILBOX_IDEM_PREFIX}${idempotencyKey}`,
    );
    const existing = parseIdemLetter(stored);
    if (existing && existing.address === address) {
      return jsonResponse(
        { letter: await joinLetter(env, existing.letter) },
        201,
      );
    }
  }

  const recipientMeta = await mailboxStub(env, address).fetch(
    "https://mailbox/meta",
  );
  if (recipientMeta.status === 404) {
    return jsonResponse({ error: "not_found" }, 404);
  }
  if (recipientMeta.status !== 200) {
    return jsonResponse({ error: "server_error" }, 500);
  }

  const lookup = await lookupRecipe(env, shareId);
  if (lookup.kind === "revoked") {
    return jsonResponse({ error: "revoked" }, 410);
  }
  if (lookup.kind === "missing") {
    return jsonResponse({ error: "not_found" }, 404);
  }

  const appended = await mailboxStub(env, address).fetch(
    "https://mailbox/letters",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shareId }),
    },
  );

  if (appended.status === 409) {
    return jsonResponse({ error: "mailbox_full" }, 409);
  }
  if (appended.status === 429) {
    return jsonResponse({ error: "rate_limited" }, 429, {
      "Retry-After": appended.headers.get("Retry-After") ?? "60",
    });
  }
  if (appended.status !== 201) {
    return jsonResponse({ error: "server_error" }, 500);
  }

  const letter = await readAppendedLetter(appended);
  if (!letter) return jsonResponse({ error: "server_error" }, 500);

  if (idempotencyKey) {
    try {
      await env.RECIPES.put(
        `${MAILBOX_IDEM_PREFIX}${idempotencyKey}`,
        JSON.stringify({ address, letter }),
        { expirationTtl: IDEMPOTENCY_TTL_SECONDS },
      );
    } catch (error) {
      // The letter is safely stored; idempotency is best-effort.
      console.error("failed to store letter idempotency key", error);
    }
  }

  return jsonResponse({ letter: await joinLetter(env, letter) }, 201);
}

async function handleMailboxDeleteLetter(
  request: Request,
  env: Env,
  address: string,
  letterId: string,
): Promise<Response> {
  const denied = await requireOwner(request, env, address);
  if (denied) return denied;

  if (letterId.length < 1 || letterId.length > 64) {
    return jsonResponse({ error: "invalid" }, 400);
  }

  const response = await mailboxStub(env, address).fetch(
    `https://mailbox/letters/${encodeURIComponent(letterId)}`,
    { method: "DELETE" },
  );
  if (response.status !== 204 && response.status !== 200) {
    return jsonResponse({ error: "server_error" }, 500);
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
  if (parsed.protocol !== "https:") {
    return textResponse("APK indisponível.\n", 404);
  }

  return Response.redirect(parsed.toString(), 302);
}

function apkConfigured(env: Env): boolean {
  const target = (env.APK_URL ?? "").trim();
  if (!target) return false;
  try {
    const parsed = new URL(target);
    return parsed.protocol === "https:";
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

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function handleRoute(
  request: Request,
  env: Env,
  url: URL,
  path: string,
  method: string,
): Promise<Response> {
  if (path === "/api/mailboxes" && method === "POST") {
    return await handleMailboxCreate(request, env);
  }

  const mailboxProfile = /^\/api\/mailboxes\/([^/]+)\/profile$/.exec(path);
  if (mailboxProfile && method === "GET") {
    return await handleMailboxProfile(env, decodeSegment(mailboxProfile[1] ?? ""));
  }

  const mailboxLetters = /^\/api\/mailboxes\/([^/]+)\/letters$/.exec(path);
  if (mailboxLetters) {
    const address = decodeSegment(mailboxLetters[1] ?? "");
    if (method === "GET") return await handleMailboxList(request, env, url, address);
    if (method === "POST") return await handleMailboxSend(request, env, address);
  }

  const mailboxLetter =
    /^\/api\/mailboxes\/([^/]+)\/letters\/([^/]+)$/.exec(path);
  if (mailboxLetter && method === "DELETE") {
    return await handleMailboxDeleteLetter(
      request,
      env,
      decodeSegment(mailboxLetter[1] ?? ""),
      decodeSegment(mailboxLetter[2] ?? ""),
    );
  }

  const mailboxPush = /^\/api\/mailboxes\/([^/]+)\/push$/.exec(path);
  if (mailboxPush && method === "PUT") {
    return await handleMailboxPush(request, env, decodeSegment(mailboxPush[1] ?? ""));
  }

  const mailboxMeta = /^\/api\/mailboxes\/([^/]+)$/.exec(path);
  if (mailboxMeta && method === "PUT") {
    return await handleMailboxUpdate(request, env, decodeSegment(mailboxMeta[1] ?? ""));
  }

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
