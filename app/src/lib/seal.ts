/**
 * Sender seal wire format (SPEC.md §4.3).
 *
 * Pure logic only: no React Native imports, so the validator and the storage
 * helpers run under `node:test` as well as on the device. The Worker applies the
 * same rules, but the app still validates before saving or sending so a broken
 * image is caught in Settings and the previous seal is kept.
 */

/** Selectable wax-stamp ids, in picker order. */
export const SIGIL_IDS = ['bee', 'cat', 'leaf', 'moon', 'mushroom', 'sea'] as const;

/** Ids from the old line-art set. Still accepted so old recipes keep their seal. */
export const LEGACY_SIGIL_IDS = ['sun', 'star', 'owl'] as const;

export type StampId = (typeof SIGIL_IDS)[number];
export type LegacySigilId = (typeof LEGACY_SIGIL_IDS)[number];
export type SigilId = StampId | LegacySigilId;
export type SealKind = 'sigil' | 'image';
export type SealMime = 'image/jpeg' | 'image/png';

export type SigilSeal = {
  kind: 'sigil';
  id: SigilId;
};

export type ImageSeal = {
  kind: 'image';
  mime: SealMime;
  data: string;
};

export type Seal = SigilSeal | ImageSeal;

/** Decoded image limit, mirroring the Worker's cap. */
export const MAX_SEAL_BYTES = 32 * 1024;

/** Canonical base64 length for MAX_SEAL_BYTES: 4 * ceil(32768 / 3). */
export const MAX_SEAL_BASE64_CHARS = 43692;

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isStampId(value: unknown): value is StampId {
  return typeof value === 'string' && (SIGIL_IDS as readonly string[]).includes(value);
}

export function isSigilId(value: unknown): value is SigilId {
  return (
    typeof value === 'string' &&
    ((SIGIL_IDS as readonly string[]).includes(value) ||
      (LEGACY_SIGIL_IDS as readonly string[]).includes(value))
  );
}

function base64Char(code: number): number {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (code === 43) return 62;
  if (code === 47) return 63;
  return -1;
}

/**
 * Standard base64 (with padding) decoded without `atob`/`Buffer`, both of which
 * are not guaranteed across Hermes and Node test runs.
 */
function decodeBase64(value: string): Uint8Array | null {
  if (value.length === 0 || value.length % 4 !== 0) return null;
  if (!BASE64_RE.test(value)) return null;

  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const byteLength = (value.length / 4) * 3 - padding;
  const bytes = new Uint8Array(byteLength);
  let offset = 0;

  for (let index = 0; index < value.length; index += 4) {
    const c0 = base64Char(value.charCodeAt(index));
    const c1 = base64Char(value.charCodeAt(index + 1));
    const c2 = value[index + 2] === '=' ? 0 : base64Char(value.charCodeAt(index + 2));
    const c3 = value[index + 3] === '=' ? 0 : base64Char(value.charCodeAt(index + 3));

    if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) return null;

    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    bytes[offset++] = (triple >> 16) & 0xff;
    if (offset < byteLength) bytes[offset++] = (triple >> 8) & 0xff;
    if (offset < byteLength) bytes[offset++] = triple & 0xff;
  }

  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let output = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const b0 = bytes[index];
    const b1 = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const b2 = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;

    output += BASE64_ALPHABET[(triple >> 18) & 63];
    output += BASE64_ALPHABET[(triple >> 12) & 63];
    output += index + 1 < bytes.length ? BASE64_ALPHABET[(triple >> 6) & 63] : '=';
    output += index + 2 < bytes.length ? BASE64_ALPHABET[triple & 63] : '=';
  }

  return output;
}

function matchesMagic(bytes: Uint8Array, mime: SealMime): boolean {
  if (mime === 'image/jpeg') {
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

/**
 * Decoded byte length of a base64 string, or null when the string is not valid
 * standard base64. Useful to reject an oversized capture before decoding it.
 */
export function base64ByteLength(value: string): number | null {
  if (value.length === 0 || value.length % 4 !== 0) return null;
  if (!BASE64_RE.test(value)) return null;

  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function parseImageSeal(mime: SealMime, data: string): ImageSeal | null {
  if (data.length > MAX_SEAL_BASE64_CHARS) return null;

  const decoded = decodeBase64(data);
  if (!decoded || decoded.length === 0 || decoded.length > MAX_SEAL_BYTES) return null;
  if (!matchesMagic(decoded, mime)) return null;

  // Rebuild from the validated bytes, so only canonical base64 is ever kept.
  return { kind: 'image', mime, data: encodeBase64(decoded) };
}

/**
 * Strict parser for an untrusted seal (network payload or stored JSON).
 * Returns null for any malformed shape, unknown sigil, bad mime, invalid
 * base64, wrong magic number, or an image decoded over 32 KB.
 */
export function parseSeal(value: unknown): Seal | null {
  if (!isRecord(value)) return null;

  if (value.kind === 'sigil') {
    return isSigilId(value.id) ? { kind: 'sigil', id: value.id } : null;
  }

  if (value.kind === 'image') {
    if (value.mime !== 'image/jpeg' && value.mime !== 'image/png') return null;
    if (typeof value.data !== 'string') return null;
    return parseImageSeal(value.mime, value.data);
  }

  return null;
}

/** The exact JSON object accepted by `POST/PUT /api/recipes`. */
export function sealToPayload(seal: Seal): Seal {
  if (seal.kind === 'sigil') {
    return { kind: 'sigil', id: seal.id };
  }
  return { kind: 'image', mime: seal.mime, data: seal.data };
}

/** Parses the `profile.seal_json` / `recipes.source_seal` column defensively. */
export function sealFromStored(json: string | null): Seal | null {
  if (!json) return null;

  try {
    return parseSeal(JSON.parse(json) as unknown);
  } catch {
    return null;
  }
}

/** Serializes a seal for `profile.seal_json` / `recipes.source_seal`. */
export function sealToStored(seal: Seal): string {
  return JSON.stringify(sealToPayload(seal));
}
