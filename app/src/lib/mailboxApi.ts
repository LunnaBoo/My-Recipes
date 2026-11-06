import { getApiConfig } from './config';
import {
  isValidLetterId,
  isValidMailboxAddress,
  isValidMailboxSecret,
  normalizeLetter,
  normalizeLetters,
  normalizeMailboxSecret,
  normalizeContactName,
  parseMailboxAddress,
  type MailboxLetter,
} from './mailbox';
import { parseSeal, sealToPayload, type Seal } from './seal';
import { isValidShareId } from './shareLink';

/**
 * HTTP client for the mailbox API (MAILBOX.md §6.2).
 *
 * Every call throws `MailboxApiError` with a typed code so screens can show a
 * precise pt-BR message and decide whether a retry is safe. Request bodies are
 * built from validated values only: a malformed address or secret is rejected
 * locally instead of becoming a confusing 404.
 */

const REQUEST_TIMEOUT_MS = 15_000;

export type MailboxErrorCode =
  | 'not_found'
  | 'revoked'
  | 'unauthorized'
  | 'offline'
  | 'server_error'
  | 'mailbox_full'
  | 'rate_limited'
  | 'invalid'
  /** Request body exceeded the server's size cap (HTTP 413). */
  | 'too_large'
  /** Registration only: the generated address already belongs to someone else. */
  | 'address_taken';

export class MailboxApiError extends Error {
  readonly code: MailboxErrorCode;

  constructor(code: MailboxErrorCode, message: string) {
    super(message);
    this.name = 'MailboxApiError';
    this.code = code;
  }
}

export type MailboxProfile = {
  /** 0-40 chars; empty when the person has not set a name. */
  name: string;
  seal: Seal | null;
};

export type RegisterMailboxInput = {
  address: string;
  secret: string;
  name: string;
  seal: Seal | null;
};

export type RegisterMailboxResult = {
  address: string;
  /** False when the server reported an idempotent retry (HTTP 200). */
  created: boolean;
};

export type FetchLettersInput = {
  address: string;
  secret: string;
  /** Return letters older than this `sentAt`, for paging. */
  before?: number;
  limit?: number;
};

export type SendLetterInput = {
  address: string;
  senderAddress: string;
  senderSecret: string;
  shareId: string;
  idempotencyKey: string;
};

export type RemoveLetterInput = {
  address: string;
  secret: string;
  letterId: string;
};

export type UpdateMailboxProfileInput = {
  address: string;
  secret: string;
  name: string;
  seal: Seal | null;
};

export type RegisterPushTokenInput = {
  address: string;
  secret: string;
  token: string;
  platform: 'android' | 'ios';
};

const KNOWN_ERROR_CODES: readonly MailboxErrorCode[] = [
  'not_found',
  'revoked',
  'unauthorized',
  'offline',
  'server_error',
  'mailbox_full',
  'rate_limited',
  'invalid',
  'too_large',
  'address_taken',
];

function isKnownErrorCode(value: unknown): value is MailboxErrorCode {
  return typeof value === 'string' && (KNOWN_ERROR_CODES as readonly string[]).includes(value);
}

function apiUrl(path: string): string {
  return `${getApiConfig().apiBase}${path}`;
}

function assertAddress(value: string): string {
  const address = parseMailboxAddress(value);
  if (!address) throw new MailboxApiError('invalid', 'invalid mailbox address');
  return address;
}

function assertSecret(value: string): string {
  const secret = normalizeMailboxSecret(value);
  if (!secret) throw new MailboxApiError('invalid', 'invalid mailbox secret');
  return secret;
}

/** Reads `{ error }` from a failed response without trusting its shape. */
async function readErrorCode(response: Response): Promise<MailboxErrorCode | null> {
  try {
    const parsed: unknown = await response.json();
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const error = (parsed as Record<string, unknown>).error;
      if (isKnownErrorCode(error)) return error;
    }
  } catch {
    // A bodyless error (401/429 from the edge) is normal.
  }
  return null;
}

function statusCode(status: number): MailboxErrorCode {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 410) return 'revoked';
  if (status === 429) return 'rate_limited';
  if (status === 413) return 'too_large';
  if (status === 400 || status === 422) return 'invalid';
  return 'server_error';
}

async function fail(response: Response): Promise<never> {
  const fromBody = await readErrorCode(response);
  throw new MailboxApiError(
    fromBody ?? statusCode(response.status),
    `mailbox request failed with ${response.status}`,
  );
}

async function request(path: string, init: RequestInit): Promise<Response> {
  let url: string;
  try {
    url = apiUrl(path);
  } catch {
    throw new MailboxApiError('server_error', 'missing api configuration');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw new MailboxApiError(
      'offline',
      error instanceof Error ? error.message : 'network request failed',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) await fail(response);
  return response;
}

function jsonInit(method: string, body: unknown, headers: Record<string, string>): RequestInit {
  return {
    method,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function ownerHeaders(secret: string): Record<string, string> {
  return { Authorization: `Bearer ${secret}` };
}

function appHeaders(): Record<string, string> {
  try {
    return { 'X-App-Key': getApiConfig().apiKey };
  } catch {
    throw new MailboxApiError('server_error', 'missing api configuration');
  }
}

function normalizeProfile(payload: unknown): MailboxProfile {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new MailboxApiError('server_error', 'invalid mailbox profile');
  }

  const record = payload as Record<string, unknown>;
  const rawName = record.name;
  if (typeof rawName !== 'string') {
    throw new MailboxApiError('server_error', 'invalid mailbox profile');
  }

  const name = normalizeContactName(rawName) ?? (rawName.trim().length === 0 ? '' : null);
  if (name === null) {
    throw new MailboxApiError('server_error', 'invalid mailbox profile');
  }

  return { name, seal: parseSeal(record.seal) };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new MailboxApiError('server_error', 'invalid mailbox response');
  }
}

/**
 * Creates the local identity on the server.
 *
 * A 409 `address_taken` is surfaced as `address_taken` (not `invalid`) so the
 * caller can generate a new address and retry, per §5.2. HTTP 200 means the
 * server already has this exact address + secret pair (idempotent retry).
 */
export async function registerMailbox(
  input: RegisterMailboxInput,
): Promise<RegisterMailboxResult> {
  const address = assertAddress(input.address);
  const secret = assertSecret(input.secret);
  const name = input.name.trim();
  if (name.length > 40) throw new MailboxApiError('invalid', 'invalid display name');

  const response = await request(
    '/api/mailboxes',
    jsonInit(
      'POST',
      { address, secret, name, seal: input.seal ? sealToPayload(input.seal) : null },
      appHeaders(),
    ),
  );

  const created = response.status === 201;
  if (!created && response.status !== 200) {
    throw new MailboxApiError('server_error', 'unexpected registration response');
  }

  return { address, created };
}

/** Public profile lookup used when adding a contact. */
export async function fetchMailboxProfile(address: string): Promise<MailboxProfile> {
  const valid = assertAddress(address);
  const response = await request(
    `/api/mailboxes/${encodeURIComponent(valid)}/profile`,
    { method: 'GET' },
  );

  return normalizeProfile(await readJson(response));
}

/**
 * Newest-first letters with the display fields joined by the server.
 * `before` pages backwards by `sentAt`; `limit` is capped server-side.
 */
export async function fetchLetters(input: FetchLettersInput): Promise<MailboxLetter[]> {
  const address = assertAddress(input.address);
  const secret = assertSecret(input.secret);

  const query: string[] = [];
  if (input.before !== undefined) {
    if (!Number.isSafeInteger(input.before)) {
      throw new MailboxApiError('invalid', 'invalid before cursor');
    }
    // `before=0` is not a real cursor (no letter can be older than epoch 0 in a
    // meaningful way); omitting it keeps the DO from paging on a bogus value.
    if (input.before > 0) query.push(`before=${input.before}`);
  }
  if (input.limit !== undefined) {
    if (!Number.isSafeInteger(input.limit) || input.limit <= 0) {
      throw new MailboxApiError('invalid', 'invalid limit');
    }
    query.push(`limit=${input.limit}`);
  }

  const suffix = query.length > 0 ? `?${query.join('&')}` : '';
  const response = await request(
    `/api/mailboxes/${encodeURIComponent(address)}/letters${suffix}`,
    { method: 'GET', headers: ownerHeaders(secret) },
  );

  const payload = await readJson(response);
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new MailboxApiError('server_error', 'invalid letters response');
  }

  const letters = normalizeLetters((payload as Record<string, unknown>).letters);
  if (!letters) throw new MailboxApiError('server_error', 'invalid letters response');

  return letters;
}

/**
 * Delivers a share to a mailbox. Authenticated as the sender: the app key
 * proves the client, the sender's secret proves ownership of the from-address.
 * The idempotency key makes a retry after a timeout return the first letter.
 */
export async function sendLetter(input: SendLetterInput): Promise<MailboxLetter> {
  const address = assertAddress(input.address);
  const senderAddress = assertAddress(input.senderAddress);
  const senderSecret = assertSecret(input.senderSecret);
  const idempotencyKey = input.idempotencyKey.trim();

  if (!isValidShareId(input.shareId)) {
    throw new MailboxApiError('invalid', 'invalid share id');
  }
  if (idempotencyKey.length === 0 || idempotencyKey.length > 128) {
    throw new MailboxApiError('invalid', 'invalid idempotency key');
  }

  const response = await request(
    `/api/mailboxes/${encodeURIComponent(address)}/letters`,
    jsonInit(
      'POST',
      { shareId: input.shareId, senderAddress },
      { ...appHeaders(), ...ownerHeaders(senderSecret), 'X-Idempotency-Key': idempotencyKey },
    ),
  );

  const payload = await readJson(response);
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new MailboxApiError('server_error', 'invalid send response');
  }

  const letter = normalizeLetter((payload as Record<string, unknown>).letter);
  if (!letter) throw new MailboxApiError('server_error', 'invalid send response');

  return letter;
}

/** Removes a letter from the server inbox; local cache cleanup is separate. */
export async function removeLetter(input: RemoveLetterInput): Promise<void> {
  const address = assertAddress(input.address);
  const secret = assertSecret(input.secret);
  if (!isValidLetterId(input.letterId)) {
    throw new MailboxApiError('invalid', 'invalid letter id');
  }

  await request(
    `/api/mailboxes/${encodeURIComponent(address)}/letters/${encodeURIComponent(input.letterId)}`,
    { method: 'DELETE', headers: ownerHeaders(secret) },
  );
}

/** Updates the name/seal other people see when they add this address. */
export async function updateMailboxProfile(
  input: UpdateMailboxProfileInput,
): Promise<MailboxProfile> {
  const address = assertAddress(input.address);
  const secret = assertSecret(input.secret);
  const name = input.name.trim();
  if (name.length > 40) throw new MailboxApiError('invalid', 'invalid display name');

  const response = await request(
    `/api/mailboxes/${encodeURIComponent(address)}`,
    jsonInit(
      'PUT',
      { name, seal: input.seal ? sealToPayload(input.seal) : null },
      ownerHeaders(secret),
    ),
  );

  if (response.status === 204) return { name, seal: input.seal };

  const payload = await readJson(response);
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new MailboxApiError('server_error', 'invalid mailbox profile');
  }

  // PUT may answer 204 or `{ name, seal }`; fall back to what was sent.
  const record = payload as Record<string, unknown>;
  if (record.name === undefined && record.seal === undefined) {
    return { name, seal: input.seal };
  }

  return normalizeProfile(record);
}

/**
 * Phase 2 hook: stores the Expo push token on the mailbox. Kept here now so the
 * notification work only touches the caller, not the transport.
 */
export async function registerPushToken(input: RegisterPushTokenInput): Promise<void> {
  const address = assertAddress(input.address);
  const secret = assertSecret(input.secret);
  const token = input.token.trim();
  if (token.length === 0 || token.length > 512) {
    throw new MailboxApiError('invalid', 'invalid push token');
  }
  if (input.platform !== 'android' && input.platform !== 'ios') {
    throw new MailboxApiError('invalid', 'invalid push platform');
  }

  await request(
    `/api/mailboxes/${encodeURIComponent(address)}/push`,
    jsonInit('PUT', { token, platform: input.platform }, ownerHeaders(secret)),
  );
}

export function isMailboxApiError(error: unknown): error is MailboxApiError {
  return error instanceof MailboxApiError;
}

/** Re-exported so callers do not need two imports for format checks. */
export { isValidMailboxAddress, isValidMailboxSecret };
