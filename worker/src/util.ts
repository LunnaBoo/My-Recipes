/**
 * Small, dependency-free helpers shared by the router and the HTML renderer.
 * Everything here assumes untrusted input: escape before interpolating.
 */

/** The six bundled line-art seals. Keep in sync with SPEC §4.3. */
export const SEAL_NAMES = [
  "cat",
  "moon",
  "sun",
  "star",
  "mushroom",
  "owl",
] as const;

export type SealName = (typeof SEAL_NAMES)[number];

export function isSealName(value: unknown): value is SealName {
  return (
    typeof value === "string" &&
    (SEAL_NAMES as readonly string[]).includes(value)
  );
}

export type SenderSeal =
  | { kind: "sigil"; id: SealName }
  | { kind: "image"; mime: "image/jpeg" | "image/png"; data: string };

export interface Recipe {
  id: string;
  v: 1;
  title: string;
  body: string;
  stepCount: number;
  sender: string;
  senderSeal?: SenderSeal;
  createdAt: number;
}

/** Alphabet without 0/O/1/I, 31 symbols. */
export const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const ID_LENGTH = 12;
export const ID_RE = /^[abcdefghjkmnpqrstuvwxyz23456789]{12}$/;

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape text for use in HTML text nodes and double-quoted attributes. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/**
 * Escape a value for a double-quoted attribute. Newlines and tabs become
 * numeric entities so `data-copy` survives any HTML parser newline
 * normalization intact.
 */
export function escapeAttr(value: string): string {
  return escapeHtml(value)
    .replace(/\r/g, "&#13;")
    .replace(/\n/g, "&#10;")
    .replace(/\t/g, "&#9;");
}

/** Unicode code-point length (user-perceived "characters" for validation). */
export function charLength(value: string): number {
  return Array.from(value).length;
}

const encoder = new TextEncoder();

export function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

/** Constant-time-ish comparison; length differences are also folded in. */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

/** 12 chars from a 31-symbol alphabet, unbiased via rejection sampling. */
export function generateId(): string {
  const bytes = new Uint8Array(ID_LENGTH * 2);
  const out: string[] = [];
  const cutoff = 256 - (256 % ID_ALPHABET.length); // 248 for 31
  while (out.length < ID_LENGTH) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= cutoff) continue;
      out.push(ID_ALPHABET[byte % ID_ALPHABET.length] ?? "");
      if (out.length === ID_LENGTH) break;
    }
  }
  return out.join("");
}

/**
 * Step counting from SPEC §4.1:
 * ordered lines first; if none, bullet lines.
 */
export function countSteps(body: string): number {
  const lines = body.split(/\r\n?|\n/);
  let count = 0;
  for (const line of lines) {
    if (/^\s*\d+[.)]\s/.test(line)) count += 1;
  }
  if (count > 0) return count;
  for (const line of lines) {
    if (/^\s*[-*]\s/.test(line)) count += 1;
  }
  return count;
}

export function isAndroid(userAgent: string | null): boolean {
  return !!userAgent && /Android/i.test(userAgent);
}

/** "12 passos · por Lucas" with either half omitted when absent. */
export function buildDescription(stepCount: number, sender: string): string {
  const parts: string[] = [];
  if (stepCount > 0) parts.push(`${stepCount} passos`);
  if (sender) parts.push(`por ${sender}`);
  return parts.join(" · ");
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return dateFormatter.format(date);
  } catch {
    return "";
  }
}

export function isValidId(value: string): boolean {
  return ID_RE.test(value);
}

/** Decoded seal cap: 32 KB (SPEC §4.3). */
export const MAX_SEAL_BYTES = 32 * 1024;

/**
 * Max canonical base64 length for MAX_SEAL_BYTES: 4 * ceil(32768 / 3).
 * Used to reject obviously oversized payloads before decoding them.
 */
const MAX_SEAL_BASE64_CHARS = 43692;

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Strictly decode standard base64. Returns both the bytes and their canonical
 * re-encoding; the canonical form is what gets stored, never the raw input.
 */
function decodeBase64(
  value: string,
): { bytes: Uint8Array; canonical: string } | null {
  if (value.length === 0 || value.length % 4 !== 0) return null;
  if (!BASE64_RE.test(value)) return null;

  let binary: string;
  try {
    binary = atob(value);
  } catch {
    return null;
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return { bytes, canonical: btoa(binary) };
}

/** Magic-number check for the two allowed raster formats. */
function matchesMagic(
  bytes: Uint8Array,
  mime: "image/jpeg" | "image/png",
): boolean {
  if (mime === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

export type SealResult =
  | { ok: true; value: SenderSeal | undefined }
  | { ok: false; status: 400 | 413 };

/**
 * Validate an optional senderSeal from a write body. Absent/null clears the
 * seal; an unknown shape, bad sigil id, non-raster mime, invalid base64,
 * wrong magic number or oversize image is rejected. The returned value is
 * rebuilt from validated primitives — raw input is never echoed back.
 */
export function validateSeal(input: unknown): SealResult {
  if (input === undefined || input === null) {
    return { ok: true, value: undefined };
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, status: 400 };
  }

  const record = input as Record<string, unknown>;

  if (record.kind === "sigil") {
    if (!isSealName(record.id)) return { ok: false, status: 400 };
    return { ok: true, value: { kind: "sigil", id: record.id } };
  }

  if (record.kind === "image") {
    const mime = record.mime;
    if (mime !== "image/jpeg" && mime !== "image/png") {
      return { ok: false, status: 400 };
    }
    if (typeof record.data !== "string") return { ok: false, status: 400 };
    if (record.data.length > MAX_SEAL_BASE64_CHARS) {
      return { ok: false, status: 413 };
    }

    const decoded = decodeBase64(record.data);
    if (!decoded) return { ok: false, status: 400 };
    if (decoded.bytes.length > MAX_SEAL_BYTES) {
      return { ok: false, status: 413 };
    }
    if (!matchesMagic(decoded.bytes, mime)) {
      return { ok: false, status: 400 };
    }

    return {
      ok: true,
      value: { kind: "image", mime, data: decoded.canonical },
    };
  }

  return { ok: false, status: 400 };
}

export type RecipeInputResult =
  | { ok: true; value: Omit<Recipe, "id" | "v" | "stepCount" | "createdAt"> }
  | { ok: false; status: 400 | 413 };

/**
 * Validate the JSON-shaped POST body. Shape errors are 400; oversized bodies
 * are 413. Never throws.
 */
export function validateRecipeInput(input: unknown): RecipeInputResult {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, status: 400 };
  }

  const record = input as Record<string, unknown>;

  if (typeof record.title !== "string") return { ok: false, status: 400 };
  const title = record.title.trim();
  if (charLength(title) < 1 || charLength(title) > 120) {
    return { ok: false, status: 400 };
  }

  if (typeof record.body !== "string") return { ok: false, status: 400 };
  const body = record.body;
  const bodyBytes = byteLength(body);
  if (bodyBytes > 65536) return { ok: false, status: 413 };
  if (bodyBytes < 1) return { ok: false, status: 400 };

  let sender = "";
  if (record.sender !== undefined && record.sender !== null) {
    if (typeof record.sender !== "string") return { ok: false, status: 400 };
    sender = record.sender.trim();
    if (charLength(sender) > 40) return { ok: false, status: 400 };
  }

  // Unknown extra keys (including any legacy tag fields) are ignored; only
  // the validated seal shape is carried into the stored recipe.
  const seal = validateSeal(record.senderSeal);
  if (!seal.ok) return { ok: false, status: seal.status };

  return {
    ok: true,
    value: { title, body, sender, senderSeal: seal.value },
  };
}
