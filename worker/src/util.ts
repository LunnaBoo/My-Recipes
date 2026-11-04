/**
 * Small, dependency-free helpers shared by the router and the HTML renderer.
 * Everything here assumes untrusted input: escape before interpolating.
 */

export interface Recipe {
  id: string;
  v: 1;
  title: string;
  body: string;
  stepCount: number;
  sender: string;
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

  return { ok: true, value: { title, body, sender } };
}
