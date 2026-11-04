import { contentHash } from './contentHash';
import { getApiConfig } from './config';
import { isValidShareId } from './shareLink';
import { stepCount } from './stepCount';

const REQUEST_TIMEOUT_MS = 15_000;

export type ShareError = 'not_found' | 'revoked' | 'offline' | 'server_error';

export type SharedRecipe = {
  id: string;
  title: string;
  body: string;
  stepCount: number;
  sender: string | null;
  /** Undefined when the server did not send the field at all. */
  senderSeal: unknown;
  createdAt: number | null;
  /** Server hash when present, otherwise the hash of the received body. */
  contentHash: string;
};

export type FetchShareResult =
  | { ok: true; recipe: SharedRecipe }
  | { ok: false; error: ShareError };

export type CreateShareInput = {
  /** Local recipe id; used only to build the idempotency key. */
  id: string;
  title: string;
  body: string;
  sender: string;
  senderSeal?: unknown;
};

export type CreatedShare = {
  id: string;
  url: string;
};

export class ShareApiError extends Error {
  readonly code: ShareError | 'unauthorized' | 'invalid' | 'too_large';

  constructor(code: ShareApiError['code'], message: string) {
    super(message);
    this.name = 'ShareApiError';
    this.code = code;
  }
}

function apiUrl(path: string): string {
  return `${getApiConfig().apiBase}${path}`;
}

async function withTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw new ShareApiError(
      'offline',
      error instanceof Error ? error.message : 'network request failed',
    );
  } finally {
    clearTimeout(timer);
  }
}

/** URL a recipient can open, built from the configured share host. */
export function shareUrlFor(shareId: string): string {
  return `${getApiConfig().apiBase}/r/${shareId}`;
}

/**
 * Publishes a recipe. The idempotency key makes a retry safe: the server
 * returns the id it created for the same recipe content instead of a new one.
 */
export async function createShare(input: CreateShareInput): Promise<CreatedShare> {
  const config = getApiConfig();
  const key = `${input.id}:${contentHash(input.body).slice(0, 16)}`;
  const payload: Record<string, unknown> = {
    title: input.title,
    body: input.body,
    sender: input.sender,
  };
  if (input.senderSeal !== undefined) payload.senderSeal = input.senderSeal;

  let response: Response;
  try {
    response = await withTimeout(`${config.apiBase}/api/recipes`, {
      method: 'POST',
      headers: {
        'X-App-Key': config.apiKey,
        'X-Idempotency-Key': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (error instanceof ShareApiError) throw error;
    throw new ShareApiError('offline', 'network request failed');
  }

  if (response.status === 401) {
    throw new ShareApiError('unauthorized', 'unauthorized');
  }
  if (response.status === 413) {
    throw new ShareApiError('too_large', 'recipe too large');
  }
  if (!response.ok) {
    throw new ShareApiError('server_error', `share failed with ${response.status}`);
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new ShareApiError('server_error', 'invalid share response');
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ShareApiError('server_error', 'invalid share response');
  }

  const record = parsed as Record<string, unknown>;
  const id = record.id;
  if (typeof id !== 'string' || !isValidShareId(id)) {
    throw new ShareApiError('server_error', 'invalid share id');
  }

  const url =
    typeof record.url === 'string' && record.url.length > 0
      ? record.url
      : shareUrlFor(id);

  return { id, url };
}

export type UpdateShareInput = {
  title: string;
  body: string;
  sender: string;
  senderSeal?: unknown;
};

/**
 * Rewrites an existing share in place so the public link serves the current
 * text. Keeps the same id and URL.
 */
export async function updateShare(
  shareId: string,
  input: UpdateShareInput,
): Promise<CreatedShare> {
  if (!isValidShareId(shareId)) {
    throw new ShareApiError('invalid', 'invalid share id');
  }

  const config = getApiConfig();
  const payload: Record<string, unknown> = {
    title: input.title,
    body: input.body,
    sender: input.sender,
  };
  if (input.senderSeal !== undefined) payload.senderSeal = input.senderSeal;

  let response: Response;
  try {
    response = await withTimeout(`${config.apiBase}/api/recipes/${shareId}`, {
      method: 'PUT',
      headers: {
        'X-App-Key': config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (error instanceof ShareApiError) throw error;
    throw new ShareApiError('offline', 'network request failed');
  }

  if (response.status === 401) throw new ShareApiError('unauthorized', 'unauthorized');
  if (response.status === 404) throw new ShareApiError('not_found', 'not found');
  if (response.status === 410) throw new ShareApiError('revoked', 'revoked');
  if (response.status === 400) throw new ShareApiError('invalid', 'invalid recipe');
  if (response.status === 413) throw new ShareApiError('too_large', 'recipe too large');
  if (!response.ok) {
    throw new ShareApiError('server_error', `update failed with ${response.status}`);
  }

  return { id: shareId, url: shareUrlFor(shareId) };
}

function normalizeShare(payload: unknown, requestedId: string): SharedRecipe | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.title !== 'string' || typeof record.body !== 'string') {
    return null;
  }

  const returnedId = typeof record.id === 'string' ? record.id : requestedId;
  if (!isValidShareId(returnedId)) return null;

  const sender =
    typeof record.sender === 'string' && record.sender.trim().length > 0
      ? record.sender.trim()
      : null;

  const createdAt =
    typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
      ? record.createdAt
      : null;

  const steps =
    typeof record.stepCount === 'number' && Number.isFinite(record.stepCount)
      ? Math.max(0, Math.trunc(record.stepCount))
      : stepCount(record.body);

  const computedHash = contentHash(record.body);
  const contentHashValue =
    typeof record.content_hash === 'string' && record.content_hash.length > 0
      ? record.content_hash
      : computedHash;

  return {
    id: returnedId,
    title: record.title,
    body: record.body,
    stepCount: steps,
    sender,
    senderSeal: 'senderSeal' in record ? record.senderSeal : undefined,
    createdAt,
    contentHash: contentHashValue,
  };
}

/** Reads a shared recipe and maps transport/HTTP failures to UI states. */
export async function fetchShare(shareId: string): Promise<FetchShareResult> {
  if (!isValidShareId(shareId)) {
    return { ok: false, error: 'not_found' };
  }

  let endpoint: string;
  try {
    endpoint = apiUrl(`/api/recipes/${encodeURIComponent(shareId)}`);
  } catch (error) {
    console.warn('[api] missing config:', error);
    return { ok: false, error: 'server_error' };
  }

  let response: Response;
  try {
    response = await withTimeout(endpoint, { method: 'GET' });
  } catch {
    return { ok: false, error: 'offline' };
  }

  if (response.status === 404) return { ok: false, error: 'not_found' };
  if (response.status === 410) return { ok: false, error: 'revoked' };
  if (!response.ok) return { ok: false, error: 'server_error' };

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return { ok: false, error: 'server_error' };
  }

  const recipe = normalizeShare(parsed, shareId);
  if (!recipe) return { ok: false, error: 'server_error' };

  return { ok: true, recipe };
}
