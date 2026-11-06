/**
 * Per-mailbox Durable Object (MAILBOX.md §6.1).
 *
 * Privacy contract (P1): a stored letter is only `{ id, shareId, sentAt }`.
 * Read state, the sender address, the recipe title/step count and the sender
 * name/seal are never written here. The Worker joins the display fields from
 * `r:<shareId>` at read time, for the authenticated recipient only.
 *
 * The object is internal: it is reached through the `MAILBOXES` binding and
 * never exposed as a public route.
 */

import type { SenderSeal } from "./util";
import {
  byteLength,
  charLength,
  generateId,
  isValidId,
  timingSafeEqual,
  validateSeal,
} from "./util";

/** Hard cap on stored letters per mailbox. */
const MAX_LETTERS = 500;
/** Per-recipient send budget, independent of the per-IP write limiter. */
const MAX_LETTERS_PER_HOUR = 60;
const HOUR_MS = 60 * 60 * 1000;
/** Page size for `GET /letters`. */
const DEFAULT_PAGE = 50;
const MAX_PAGE = 100;
/** Push tokens kept per mailbox (one per device, roughly). */
const MAX_PUSH_TOKENS = 3;
/** Raw body cap; a 32 KB seal is ~44 KB of base64. */
const MAX_BODY_BYTES = 200_000;

const META_KEY = "meta";
const LETTERS_KEY = "letters";
const PUSH_TOKENS_KEY = "pushTokens";

const SECRET_HASH_RE = /^[0-9a-f]{64}$/;

export interface MailboxMeta {
  address: string;
  secretHash: string;
  name: string;
  seal: SenderSeal | null;
  createdAt: number;
  updatedAt: number;
}

export interface Letter {
  id: string;
  shareId: string;
  sentAt: number;
}

export interface PushToken {
  token: string;
  platform: string;
  createdAt: number;
}

export interface MailboxProfile {
  name: string;
  seal: SenderSeal | null;
}

/** sha256(secret), lowercase hex. The raw secret is never stored. */
export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** 32 random bytes, hex encoded — the mailbox read token format. */
export function isValidSecret(value: string): boolean {
  return SECRET_HASH_RE.test(value);
}

function json(
  data: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return new Response(JSON.stringify(data), { status, headers });
}

function noContent(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

type ParsedBody =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; status: 400 | 413 };

/**
 * Read a small JSON object from an internal request. Bodies never exceed a
 * seal payload plus a handful of fields; anything larger is rejected before
 * parsing so a hostile caller cannot buffer unbounded input.
 */
async function readJsonObject(request: Request): Promise<ParsedBody> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, status: 413 };
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400 };
  }
  if (byteLength(text) > MAX_BODY_BYTES) return { ok: false, status: 413 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, status: 400 };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, status: 400 };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

function bodyError(status: 400 | 413): Response {
  return json({ error: status === 413 ? "too_large" : "invalid" }, status);
}

/** Trim and cap a display name; null when the value is not usable. */
function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (charLength(name) > 40) return null;
  return name;
}

type SealParse =
  | { ok: true; value: SenderSeal | null }
  | { ok: false; status: 400 | 413 };

function parseSeal(value: unknown): SealParse {
  const seal = validateSeal(value);
  if (!seal.ok) return { ok: false, status: seal.status };
  return { ok: true, value: seal.value ?? null };
}

async function readLetters(storage: DurableObjectStorage): Promise<Letter[]> {
  const stored = await storage.get<Letter[]>(LETTERS_KEY);
  return Array.isArray(stored) ? stored : [];
}

function isLetter(value: unknown): value is Letter {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.shareId === "string" &&
    typeof record.sentAt === "number"
  );
}

export class Mailbox implements DurableObject {
  private readonly storage: DurableObjectStorage;

  constructor(ctx: DurableObjectState) {
    this.storage = ctx.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const path = url.pathname;

    if (path === "/init" && method === "POST") return this.init(request);
    if (path === "/meta" && method === "GET") return this.getMeta();
    if (path === "/meta" && method === "PUT") return this.putMeta(request);
    if (path === "/verify" && method === "POST") return this.verify(request);
    if (path === "/letters" && method === "GET") return this.listLetters(url);
    if (path === "/letters" && method === "POST") return this.addLetter(request);
    if (path.startsWith("/letters/") && method === "DELETE") {
      return this.deleteLetter(path.slice("/letters/".length));
    }
    if (path === "/push" && method === "PUT") return this.putPush(request);

    return json({ error: "not_found" }, 404);
  }

  private async init(request: Request): Promise<Response> {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return bodyError(parsed.status);
    const body = parsed.value;

    const secretHash = body.secretHash;
    if (typeof secretHash !== "string" || !SECRET_HASH_RE.test(secretHash)) {
      return json({ error: "invalid" }, 400);
    }

    const name = normalizeName(body.name);
    if (name === null) return json({ error: "invalid" }, 400);

    const seal = parseSeal(body.seal);
    if (!seal.ok) return bodyError(seal.status);

    // Informational only; the binding name is the real identity. Accepted when
    // the caller sends it (the Worker always does) and validated when present.
    let address = "";
    if (body.address !== undefined && body.address !== null) {
      if (typeof body.address !== "string" || !isValidId(body.address)) {
        return json({ error: "invalid" }, 400);
      }
      address = body.address;
    }

    const existing = await this.storage.get<MailboxMeta>(META_KEY);
    if (existing) return json({ error: "exists" }, 409);

    const now = Date.now();
    const meta: MailboxMeta = {
      address,
      secretHash,
      name,
      seal: seal.value,
      createdAt: now,
      updatedAt: now,
    };
    await this.storage.put(META_KEY, meta);

    return json({ address }, 201);
  }

  /** Public projection: the hash and timestamps never leave the object. */
  private async getMeta(): Promise<Response> {
    const meta = await this.storage.get<MailboxMeta>(META_KEY);
    if (!meta) return json({ error: "not_found" }, 404);
    const profile: MailboxProfile = { name: meta.name, seal: meta.seal ?? null };
    return json(profile, 200);
  }

  private async putMeta(request: Request): Promise<Response> {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return bodyError(parsed.status);
    const body = parsed.value;

    const name = normalizeName(body.name);
    if (name === null) return json({ error: "invalid" }, 400);

    const seal = parseSeal(body.seal);
    if (!seal.ok) return bodyError(seal.status);

    const meta = await this.storage.get<MailboxMeta>(META_KEY);
    if (!meta) return json({ error: "not_found" }, 404);

    const updated: MailboxMeta = {
      ...meta,
      name,
      seal: seal.value,
      updatedAt: Date.now(),
    };
    await this.storage.put(META_KEY, updated);

    const profile: MailboxProfile = { name, seal: seal.value };
    return json(profile, 200);
  }

  private async verify(request: Request): Promise<Response> {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return bodyError(parsed.status);
    const secret = parsed.value.secret;
    if (typeof secret !== "string") return json({ error: "invalid" }, 400);

    const meta = await this.storage.get<MailboxMeta>(META_KEY);
    if (!meta) return json({ error: "unauthorized" }, 403);

    const hash = await hashSecret(secret);
    if (!timingSafeEqual(hash, meta.secretHash)) {
      return json({ error: "unauthorized" }, 403);
    }
    return json({ ok: true }, 200);
  }

  private async listLetters(url: URL): Promise<Response> {
    const stored = (await readLetters(this.storage)).filter(isLetter);

    const rawLimit = Number(url.searchParams.get("limit") ?? "");
    const limit =
      Number.isFinite(rawLimit) && rawLimit >= 1
        ? Math.min(Math.floor(rawLimit), MAX_PAGE)
        : DEFAULT_PAGE;

    const rawBefore = Number(url.searchParams.get("before") ?? "");
    const before =
      Number.isFinite(rawBefore) && rawBefore > 0 ? rawBefore : null;

    const filtered =
      before === null
        ? stored
        : stored.filter((letter) => letter.sentAt < before);

    return json({ letters: filtered.slice(0, limit) }, 200);
  }

  private async addLetter(request: Request): Promise<Response> {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return bodyError(parsed.status);

    const shareId = parsed.value.shareId;
    if (typeof shareId !== "string" || !isValidId(shareId)) {
      return json({ error: "invalid" }, 400);
    }

    const letters = (await readLetters(this.storage)).filter(isLetter);

    if (letters.length >= MAX_LETTERS) {
      return json({ error: "mailbox_full" }, 409);
    }

    const now = Date.now();
    const recent = letters.filter(
      (letter) => now - letter.sentAt < HOUR_MS && letter.sentAt <= now,
    );
    if (recent.length >= MAX_LETTERS_PER_HOUR) {
      const oldest = recent[recent.length - 1]?.sentAt ?? now;
      const retryAfter = Math.max(1, Math.ceil((oldest + HOUR_MS - now) / 1000));
      return json({ error: "rate_limited" }, 429, {
        "Retry-After": String(retryAfter),
      });
    }

    const letter: Letter = { id: generateId(), shareId, sentAt: now };
    // Newest first; `letters` is the only ordering the list endpoint needs.
    await this.storage.put(LETTERS_KEY, [letter, ...letters]);

    return json({ letter }, 201);
  }

  private async deleteLetter(rawId: string): Promise<Response> {
    let id = rawId;
    try {
      id = decodeURIComponent(rawId);
    } catch {
      // Keep the raw value; a malformed id simply matches nothing.
    }
    if (id.length > 64) return json({ error: "invalid" }, 400);

    const letters = (await readLetters(this.storage)).filter(isLetter);
    const next = letters.filter((letter) => letter.id !== id);
    if (next.length !== letters.length) {
      await this.storage.put(LETTERS_KEY, next);
    }
    return noContent();
  }

  private async putPush(request: Request): Promise<Response> {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return bodyError(parsed.status);
    const body = parsed.value;

    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (token.length < 1 || token.length > 512) {
      return json({ error: "invalid" }, 400);
    }
    const platform =
      typeof body.platform === "string" ? body.platform.trim() : "";
    if (platform.length < 1 || platform.length > 32) {
      return json({ error: "invalid" }, 400);
    }

    const stored = await this.storage.get<PushToken[]>(PUSH_TOKENS_KEY);
    const tokens = Array.isArray(stored) ? stored : [];
    const entry: PushToken = { token, platform, createdAt: Date.now() };
    const next = [entry, ...tokens.filter((item) => item.token !== token)].slice(
      0,
      MAX_PUSH_TOKENS,
    );
    await this.storage.put(PUSH_TOKENS_KEY, next);

    return noContent();
  }
}
