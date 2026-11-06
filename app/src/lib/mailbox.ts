import { parseSeal, sealToStored } from './seal';
import { isValidShareId } from './shareLink';

/**
 * Mailbox identity and letter wire format (MAILBOX.md §5, §6.2).
 *
 * Pure logic only: no React Native or database imports, so every helper here
 * runs under `node:test` as well as on the device. The API client
 * (`mailboxApi.ts`), the repository (`db/mailboxRepository.ts`) and the backup
 * import all validate through this module so there is a single definition of
 * "a valid address", "a valid letter" and "a valid contact name".
 */

/** Public address alphabet: no `i`, `l`, `o`, `0` or `1` (share alphabet). */
export const MAILBOX_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export const MAILBOX_ADDRESS_LENGTH = 12;

/** 32 random bytes, hex-encoded. */
export const MAILBOX_SECRET_BYTES = 32;
export const MAILBOX_SECRET_HEX_LENGTH = MAILBOX_SECRET_BYTES * 2;

/** Public mailbox address, e.g. `k7m2x9q4p8r3`. */
export const MAILBOX_ADDRESS_RE = new RegExp(
  `^[${MAILBOX_ALPHABET}]{${MAILBOX_ADDRESS_LENGTH}}$`,
);

/** Read token: lowercase hex, exactly 64 chars. */
export const MAILBOX_SECRET_RE = /^[0-9a-f]{64}$/;

/**
 * Server letter ids use the same 12-char alphabet as mailbox addresses:
 * no `i`, `l`, `o`, `0` or `1`. Keeping this exact (rather than `[a-z2-9]`)
 * means a local id check can never accept an id the server would reject.
 */
export const LETTER_ID_RE = new RegExp(`^[${MAILBOX_ALPHABET}]{12}$`);

/** Server profile names are 0-40 chars; contacts must have 1-40. */
export const MAX_PROFILE_NAME_LENGTH = 40;
export const MAX_CONTACT_NAME_LENGTH = 40;

/** Recipe titles accepted from the server list join. */
export const MAX_LETTER_TITLE_LENGTH = 120;

export type MailboxIdentity = {
  address: string;
  secret: string;
};

/**
 * A letter as cached locally: the server row plus the display fields joined
 * from the share at read time. `senderSeal` is the canonical stored JSON, so it
 * can be written straight into `letters.sender_seal`.
 */
export type MailboxLetter = {
  id: string;
  shareId: string;
  sentAt: number;
  title: string | null;
  stepCount: number | null;
  senderName: string | null;
  senderSeal: string | null;
  available: boolean;
};

export type ContactDraft = {
  address: string;
  displayName: string;
};

export type ContactValidation =
  | { ok: true; contact: ContactDraft }
  | { ok: false; error: 'invalid_address' | 'invalid_name' };

/** Minimal shape needed to count unread letters, either wire or row shaped. */
export type LetterReadState = {
  readAt?: number | null;
  read_at?: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isOptionalCount(value: unknown): value is number | null {
  return value === null || isTimestamp(value);
}

export function isValidMailboxAddress(value: unknown): value is string {
  return typeof value === 'string' && MAILBOX_ADDRESS_RE.test(value);
}

export function isValidMailboxSecret(value: unknown): value is string {
  return typeof value === 'string' && MAILBOX_SECRET_RE.test(value);
}

export function isValidLetterId(value: unknown): value is string {
  return typeof value === 'string' && LETTER_ID_RE.test(value);
}

/**
 * Accepts what a person pastes into "add contact": trim and lowercase only.
 * A full URL is not an address — the mailbox code is shared bare on purpose.
 */
export function parseMailboxAddress(value: string): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return MAILBOX_ADDRESS_RE.test(trimmed) ? trimmed : null;
}

/** Trimmed/lowercased secret, or null when it is not 64 hex chars. */
export function normalizeMailboxSecret(value: string): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return MAILBOX_SECRET_RE.test(trimmed) ? trimmed : null;
}

function toHex(bytes: Uint8Array): string {
  let output = '';
  for (const byte of bytes) {
    output += byte.toString(16).padStart(2, '0');
  }
  return output;
}

/**
 * Uniform random string over `alphabet`.
 *
 * 256 is not a multiple of 31, so plain modulo would bias the first eight
 * characters. Bytes at or above the largest multiple of the alphabet size are
 * rejected instead (rejection sampling), and another batch is drawn.
 */
function randomString(
  length: number,
  alphabet: string,
  randomBytes: (size: number) => Uint8Array,
): string {
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  let output = '';

  while (output.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= limit) continue;
      output += alphabet[byte % alphabet.length];
      if (output.length === length) break;
    }
  }

  return output;
}

/**
 * Builds a fresh address + read secret from a byte source.
 *
 * The byte source is injected so this stays pure and testable; the device
 * wrapper (`newMailboxId.ts`) passes `expo-crypto`'s `getRandomValues`. There
 * is deliberately no `Math.random` fallback: a weak address would be guessable
 * and a weak secret would be brute-forceable.
 */
export function buildMailboxIdentity(
  randomBytes: (length: number) => Uint8Array,
): MailboxIdentity {
  return {
    address: randomString(MAILBOX_ADDRESS_LENGTH, MAILBOX_ALPHABET, randomBytes),
    secret: toHex(randomBytes(MAILBOX_SECRET_BYTES)),
  };
}

/** Collapses runs of whitespace so a pasted name does not keep line breaks. */
export function normalizeContactName(value: string): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0 || trimmed.length > MAX_CONTACT_NAME_LENGTH) return null;
  return trimmed;
}

export function validateContact(input: {
  address: string;
  displayName: string;
}): ContactValidation {
  const address = parseMailboxAddress(input.address);
  if (!address) return { ok: false, error: 'invalid_address' };

  const displayName = normalizeContactName(input.displayName);
  if (!displayName) return { ok: false, error: 'invalid_name' };

  return { ok: true, contact: { address, displayName } };
}

function normalizeTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LETTER_TITLE_LENGTH) return null;
  return trimmed;
}

function normalizeSenderName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PROFILE_NAME_LENGTH) return null;
  return trimmed;
}

/**
 * Strict parser for one letter from `GET /letters`.
 *
 * `available: false` means the share was removed or revoked: the server omits
 * the display fields, and any that slipped through are dropped so the cached
 * row shows "Carta indisponível" instead of stale text.
 *
 * An invalid `senderSeal` is decorative and only nulled, never fatal. Anything
 * structural (id, shareId, sentAt, available) rejects the letter.
 */
export function normalizeLetter(value: unknown): MailboxLetter | null {
  if (!isRecord(value)) return null;

  const id = value.id;
  if (!isValidLetterId(id)) return null;

  const shareId = value.shareId;
  if (typeof shareId !== 'string' || !isValidShareId(shareId)) return null;

  const sentAt = value.sentAt;
  if (!isTimestamp(sentAt)) return null;

  const available = value.available;
  if (typeof available !== 'boolean') return null;

  if (!available) {
    // An unavailable letter carries no display data at all: `stepCount` may be
    // absent, so this branch must come before any display-field validation.
    return {
      id,
      shareId,
      sentAt,
      title: null,
      stepCount: null,
      senderName: null,
      senderSeal: null,
      available: false,
    };
  }

  const rawStepCount = value.stepCount;
  if (!isOptionalCount(rawStepCount)) return null;

  // `sender` is the documented field; `senderName` is tolerated so an older
  // payload does not blank the list.
  const senderName = normalizeSenderName(value.sender ?? value.senderName);

  let title: string | null = null;
  if (value.title !== null && value.title !== undefined) {
    title = normalizeTitle(value.title);
    // A title that is present but unusable is a protocol error, not a gap.
    if (title === null) return null;
  }

  const stepCount = rawStepCount === null ? null : Math.max(0, Math.trunc(rawStepCount));

  const seal = parseSeal(value.senderSeal);
  const senderSeal = seal ? sealToStored(seal) : null;

  return {
    id,
    shareId,
    sentAt,
    title,
    stepCount,
    senderName,
    senderSeal,
    available: true,
  };
}

/**
 * Normalizes the `{ letters: [...] }` payload. Returns null when the payload is
 * not an array (a protocol error), and drops individual malformed or duplicated
 * rows so one bad letter cannot blank the whole inbox.
 */
export function normalizeLetters(value: unknown): MailboxLetter[] | null {
  if (!Array.isArray(value)) return null;

  const letters: MailboxLetter[] = [];
  const seen = new Set<string>();

  for (const raw of value) {
    const letter = normalizeLetter(raw);
    if (!letter) continue;
    if (seen.has(letter.id)) continue;
    seen.add(letter.id);
    letters.push(letter);
  }

  return letters;
}

export function isUnread(letter: LetterReadState): boolean {
  const readAt = letter.readAt !== undefined ? letter.readAt : letter.read_at;
  return readAt === null || readAt === undefined;
}

export function unreadCount(letters: readonly LetterReadState[]): number {
  return letters.reduce((count, letter) => (isUnread(letter) ? count + 1 : count), 0);
}

export type LocalReadState = {
  letter_id: string;
  read_at: number | null;
};

/**
 * Plans how read ids restored from a backup meet the local letter cache
 * (MAILBOX.md §10).
 *
 * - `apply`: the letter is cached and still unread → mark it read now.
 * - `pending`: the letter has not been fetched yet → keep the id until the
 *   next mailbox refetch inserts it.
 * - ids that are already read locally are dropped: the local timestamp wins.
 */
export function planReadStateMerge(
  localLetters: readonly LocalReadState[],
  incoming: readonly string[],
): { apply: string[]; pending: string[] } {
  const local = new Map(localLetters.map((row) => [row.letter_id, row.read_at]));
  const apply: string[] = [];
  const pending: string[] = [];
  const seen = new Set<string>();

  for (const id of incoming) {
    if (!isValidLetterId(id) || seen.has(id)) continue;
    seen.add(id);

    if (!local.has(id)) {
      pending.push(id);
      continue;
    }

    if (local.get(id) === null) apply.push(id);
  }

  return { apply, pending };
}

/**
 * Whether a mailbox refresh may prune cached letters.
 *
 * Only a refresh that fetched every page knows the full server list; a paged
 * read sees a subset and must never delete the rows it did not ask for.
 */
export function shouldPruneLetters(fetchedAllPages: boolean): boolean {
  return fetchedAllPages === true;
}
