import {
  getMailbox,
  saveMailbox,
  syncLetters,
  upsertLetters,
} from '../db/mailboxRepository';
import { getProfile } from '../db/repository';
import type { Mailbox } from '../db/types';
import {
  fetchLetters,
  registerMailbox,
  type MailboxApiError,
} from './mailboxApi';
import { newMailboxIdentity } from './newMailboxId';
import { sealFromStored, sealToPayload } from './seal';

/**
 * Mailbox lifecycle helper: lazy identity creation and letter refresh.
 *
 * This module keeps the screens free of the generate/register/save/paging
 * plumbing. It is still UI-free so it can be tested in Node.
 */

const PAGE_LIMIT = 100;
const MAX_LETTERS = 500;
const MAX_REGISTRATION_RETRIES = 3;

export class MailboxSessionError extends Error {
  readonly code: 'offline' | 'unauthorized' | 'server_error' | 'invalid';

  constructor(code: MailboxSessionError['code'], message: string) {
    super(message);
    this.name = 'MailboxSessionError';
    this.code = code;
  }
}

function mapApiError(error: MailboxApiError): MailboxSessionError {
  if (error.code === 'offline') {
    return new MailboxSessionError('offline', error.message);
  }
  if (error.code === 'unauthorized') {
    return new MailboxSessionError('unauthorized', error.message);
  }
  if (error.code === 'invalid' || error.code === 'address_taken') {
    return new MailboxSessionError('invalid', error.message);
  }
  return new MailboxSessionError('server_error', error.message);
}

/**
 * Returns the existing mailbox or creates and registers a new one.
 *
 * A 409 `address_taken` is handled by generating a fresh address and retrying
 * a few times; anything else is surfaced as a typed session error.
 */
export async function ensureMailbox(): Promise<Mailbox> {
  const existing = await getMailbox();
  if (existing) return existing;

  const profile = await getProfile().catch(() => ({
    displayName: '',
    sealJson: null as string | null,
  }));

  const seal = sealFromStored(profile.sealJson ?? null);

  for (let attempt = 0; attempt < MAX_REGISTRATION_RETRIES; attempt += 1) {
    const identity = newMailboxIdentity();

    try {
      await registerMailbox({
        address: identity.address,
        secret: identity.secret,
        name: profile.displayName.trim(),
        seal: seal ? sealToPayload(seal) : null,
      });

      return saveMailbox({
        address: identity.address,
        secret: identity.secret,
        registeredAt: Date.now(),
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'address_taken') {
        continue;
      }
      throw mapApiError(error as MailboxApiError);
    }
  }

  throw new MailboxSessionError('server_error', 'could not register mailbox');
}

type RefreshResult = {
  complete: boolean;
  inserted: number;
  pruned: number;
};

/**
 * Fetches every page of letters (up to 500) and reconciles the local cache.
 *
 * Only a full fetch prunes local rows that no longer exist on the server. If
 * the network fails mid-paging, or the server already has 500 letters, the
 * already-fetched pages are upserted and nothing is removed.
 */
export async function refreshMailboxLetters(mailbox: Mailbox): Promise<RefreshResult> {
  const all: Awaited<ReturnType<typeof fetchLetters>> = [];
  let before: number | undefined;
  let complete = false;

  while (all.length < MAX_LETTERS) {
    try {
      const page = await fetchLetters({
        address: mailbox.address,
        secret: mailbox.secret,
        before,
        limit: PAGE_LIMIT,
      });

      if (page.length === 0) {
        complete = true;
        break;
      }

      all.push(...page);

      if (page.length < PAGE_LIMIT) {
        complete = true;
        break;
      }

      const last = page[page.length - 1];
      before = last.sentAt;
    } catch (error) {
      if (all.length === 0) {
        // The first page failed: rethrow so the caller can show the offline
        // state and keep the existing cache untouched.
        throw mapApiError(error as MailboxApiError);
      }
      // We got a partial list. Upsert it and do not prune.
      complete = false;
      break;
    }
  }

  if (all.length >= MAX_LETTERS) {
    complete = false;
  }

  if (complete) {
    const result = await syncLetters(all, { complete: true });
    return { complete: true, ...result };
  }

  const inserted = await upsertLetters(all);
  return { complete: false, inserted, pruned: 0 };
}
