import {
  isValidLetterId,
  normalizeContactName,
  normalizeMailboxSecret,
  parseMailboxAddress,
  planReadStateMerge,
  shouldPruneLetters,
  validateContact,
  type MailboxLetter,
} from '../lib/mailbox';
import { newId } from '../lib/newId';
import { getDb } from './client';
import type { AddContactInput, ContactRow, LetterRow, Mailbox } from './types';

/**
 * SQL for the mailbox tables (MAILBOX.md §7.1).
 *
 * Screens never build SQL: every read/write goes through one of these
 * functions. All statements are parameterized. `letters` is a cache of the
 * server list; `read_at` is local-only and must never be sent to the Worker.
 */

/** Machine-readable failure, so the caller can pick the pt-BR message. */
export class MailboxDataError extends Error {
  readonly code:
    | 'invalid_address'
    | 'invalid_secret'
    | 'invalid_name'
    | 'invalid_letter_id'
    | 'invalid_letter';

  constructor(code: MailboxDataError['code'], message: string) {
    super(message);
    this.name = 'MailboxDataError';
    this.code = code;
  }
}

/** Read ids from a backup that arrived before their letter did. */
const PENDING_READ_KEY = 'mailbox.pendingReadIds';

/** A mailbox holds at most 500 letters; this is generous headroom. */
const MAX_PENDING_READ_IDS = 2000;

/**
 * Ids per `IN (...)` statement. SQLite's historical host-parameter limit is
 * 999, so 500 keeps a large restored backup from failing mid-import.
 */
const READ_STATE_ID_CHUNK = 500;

type SqlDatabase = Awaited<ReturnType<typeof getDb>>;

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function toMailbox(row: {
  address: string;
  secret: string;
  registered_at: number;
}): Mailbox {
  return {
    address: row.address,
    secret: row.secret,
    registeredAt: row.registered_at,
  };
}

/** The singleton identity, or null before the first mailbox action. */
export async function getMailbox(): Promise<Mailbox | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    address: string;
    secret: string;
    registered_at: number;
  }>('SELECT address, secret, registered_at FROM mailbox WHERE id = 1');

  return row ? toMailbox(row) : null;
}

/**
 * Writes the singleton identity. A backup import uses this to adopt an
 * identity on a fresh install; callers must check `getMailbox()` first.
 */
export async function saveMailbox(input: {
  address: string;
  secret: string;
  registeredAt?: number;
}): Promise<Mailbox> {
  const address = parseMailboxAddress(input.address);
  if (!address) throw new MailboxDataError('invalid_address', 'invalid mailbox address');

  const secret = normalizeMailboxSecret(input.secret);
  if (!secret) throw new MailboxDataError('invalid_secret', 'invalid mailbox secret');

  const registeredAt = input.registeredAt ?? Date.now();
  if (!isTimestamp(registeredAt)) {
    throw new MailboxDataError('invalid_secret', 'invalid registration timestamp');
  }

  const db = await getDb();
  await db.runAsync(
    `INSERT INTO mailbox (id, address, secret, registered_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       address = excluded.address,
       secret = excluded.secret,
       registered_at = excluded.registered_at`,
    [address, secret, registeredAt],
  );

  const saved = await getMailbox();
  if (!saved) throw new MailboxDataError('invalid_address', 'mailbox was not saved');
  return saved;
}

export async function listContacts(): Promise<ContactRow[]> {
  const db = await getDb();
  return db.getAllAsync<ContactRow>(
    'SELECT * FROM contacts ORDER BY display_name COLLATE NOCASE, created_at',
  );
}

export async function getContactByAddress(address: string): Promise<ContactRow | null> {
  const valid = parseMailboxAddress(address);
  if (!valid) return null;

  const db = await getDb();
  const row = await db.getFirstAsync<ContactRow>(
    'SELECT * FROM contacts WHERE mailbox_address = ?',
    valid,
  );
  return row ?? null;
}

/**
 * Adds a contact. An address that is already saved is left untouched and its
 * existing row is returned: local edits always win over an incoming snapshot.
 */
export async function addContact(input: AddContactInput): Promise<ContactRow> {
  const validation = validateContact({
    address: input.address,
    displayName: input.displayName,
  });
  if (!validation.ok) {
    throw new MailboxDataError(validation.error, `invalid contact: ${validation.error}`);
  }

  const createdAt = input.createdAt ?? Date.now();
  if (!isTimestamp(createdAt)) {
    throw new MailboxDataError('invalid_name', 'invalid contact timestamp');
  }
  const lastSentAt = input.lastSentAt ?? null;
  if (lastSentAt !== null && !isTimestamp(lastSentAt)) {
    throw new MailboxDataError('invalid_name', 'invalid contact timestamp');
  }

  const db = await getDb();
  await db.runAsync(
    `INSERT INTO contacts (
       id, mailbox_address, display_name, seal_json, created_at, last_sent_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(mailbox_address) DO NOTHING`,
    [
      newId(),
      validation.contact.address,
      validation.contact.displayName,
      input.sealJson ?? null,
      createdAt,
      lastSentAt,
    ],
  );

  const saved = await getContactByAddress(validation.contact.address);
  if (!saved) throw new MailboxDataError('invalid_address', 'contact was not saved');
  return saved;
}

export async function removeContact(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.runAsync('DELETE FROM contacts WHERE id = ?', id);
  return result.changes > 0;
}

export async function updateContactName(id: string, displayName: string): Promise<ContactRow | null> {
  const name = normalizeContactName(displayName);
  if (!name) throw new MailboxDataError('invalid_name', 'invalid contact name');

  const db = await getDb();
  const result = await db.runAsync(
    'UPDATE contacts SET display_name = ? WHERE id = ?',
    [name, id],
  );
  if (result.changes === 0) return null;

  const row = await db.getFirstAsync<ContactRow>('SELECT * FROM contacts WHERE id = ?', id);
  return row ?? null;
}

/** Records that a recipe was sent to this contact (used for ordering later). */
export async function touchContactSent(id: string, at = Date.now()): Promise<boolean> {
  const db = await getDb();
  const result = await db.runAsync(
    'UPDATE contacts SET last_sent_at = ? WHERE id = ?',
    [at, id],
  );
  return result.changes > 0;
}

async function readPendingReadIds(db: SqlDatabase): Promise<string[]> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_meta WHERE key = ?',
    PENDING_READ_KEY,
  );
  if (!row) return [];

  try {
    const parsed: unknown = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    for (const value of parsed) {
      if (isValidLetterId(value)) seen.add(value);
    }
    return [...seen].slice(0, MAX_PENDING_READ_IDS);
  } catch {
    return [];
  }
}

async function writePendingReadIds(db: SqlDatabase, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) {
    await db.runAsync('DELETE FROM app_meta WHERE key = ?', PENDING_READ_KEY);
    return;
  }

  await db.runAsync(
    `INSERT INTO app_meta (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [PENDING_READ_KEY, JSON.stringify(ids.slice(0, MAX_PENDING_READ_IDS))],
  );
}

/**
 * Inserts or refreshes cached letters, preserving local read state.
 *
 * Display fields and `available` always follow the server, except that a null
 * incoming display field keeps the cached value: an unavailable letter has no
 * title/steps/sender, and blanking those would lose the text the inbox already
 * showed. `read_at` and `received_at` are never overwritten by a refresh. Read
 * ids that arrived in a backup before their letter are applied on insert and
 * then dropped.
 */
export async function upsertLetters(letters: readonly MailboxLetter[]): Promise<number> {
  if (letters.length === 0) return 0;

  // Validate before opening the transaction: a malformed letter must not leave
  // half a refresh committed.
  for (const letter of letters) {
    if (!isValidLetterId(letter.id)) {
      throw new MailboxDataError('invalid_letter_id', 'invalid letter id');
    }
    if (!isTimestamp(letter.sentAt)) {
      throw new MailboxDataError('invalid_letter', 'invalid letter timestamp');
    }
  }

  const db = await getDb();
  const now = Date.now();
  const ids = letters.map((letter) => letter.id);
  const placeholders = ids.map(() => '?').join(', ');
  let inserted = 0;

  await db.withTransactionAsync(async () => {
    const pending = new Set(await readPendingReadIds(db));
    const existingRows = await db.getAllAsync<{ letter_id: string }>(
      `SELECT letter_id FROM letters WHERE letter_id IN (${placeholders})`,
      ids,
    );
    const existing = new Set(existingRows.map((row) => row.letter_id));

    for (const letter of letters) {
      const readAt = pending.has(letter.id) ? now : null;

      await db.runAsync(
        `INSERT INTO letters (
           letter_id, share_id, title, step_count, sender_name, sender_seal,
           sent_at, read_at, available, received_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(letter_id) DO UPDATE SET
           share_id = excluded.share_id,
           title = COALESCE(excluded.title, letters.title),
           step_count = COALESCE(excluded.step_count, letters.step_count),
           sender_name = COALESCE(excluded.sender_name, letters.sender_name),
           sender_seal = COALESCE(excluded.sender_seal, letters.sender_seal),
           sent_at = excluded.sent_at,
           available = excluded.available`,
        [
          letter.id,
          letter.shareId,
          letter.title,
          letter.stepCount,
          letter.senderName,
          letter.senderSeal,
          letter.sentAt,
          readAt,
          letter.available ? 1 : 0,
          now,
        ],
      );

      if (!existing.has(letter.id)) {
        existing.add(letter.id);
        inserted += 1;
      }

      // The letter is local now; a pending read id has been applied (or the
      // existing row already had its own state) and is no longer needed.
      pending.delete(letter.id);
    }

    await writePendingReadIds(db, [...pending]);
  });

  return inserted;
}

/** Drops cached letters the server no longer has. */
export async function pruneLetters(keepIds: readonly string[]): Promise<number> {
  const db = await getDb();

  if (keepIds.length === 0) {
    const result = await db.runAsync('DELETE FROM letters');
    return result.changes;
  }

  const placeholders = keepIds.map(() => '?').join(', ');
  const result = await db.runAsync(
    `DELETE FROM letters WHERE letter_id NOT IN (${placeholders})`,
    [...keepIds],
  );
  return result.changes;
}

/**
 * Refreshes the cache from a server list.
 *
 * `complete: true` means the caller fetched every page, so the list is the
 * whole server inbox and rows absent from it can be pruned. A paged read must
 * pass `complete: false`: it is upsert-only, because letters it did not fetch
 * are still on the server. `upsertLetters` itself is always upsert-only.
 */
export async function syncLetters(
  letters: readonly MailboxLetter[],
  options: { complete: boolean },
): Promise<{ inserted: number; pruned: number }> {
  const inserted = await upsertLetters(letters);
  const pruned = shouldPruneLetters(options.complete)
    ? await pruneLetters(letters.map((letter) => letter.id))
    : 0;
  return { inserted, pruned };
}

export async function listLetters(): Promise<LetterRow[]> {
  const db = await getDb();
  return db.getAllAsync<LetterRow>(
    'SELECT * FROM letters ORDER BY sent_at DESC, received_at DESC',
  );
}

export async function getLetter(letterId: string): Promise<LetterRow | null> {
  if (!isValidLetterId(letterId)) return null;

  const db = await getDb();
  const row = await db.getFirstAsync<LetterRow>(
    'SELECT * FROM letters WHERE letter_id = ?',
    letterId,
  );
  return row ?? null;
}

/** Marks unread → read. Already-read letters are left with their first timestamp. */
export async function markLetterRead(letterId: string, at = Date.now()): Promise<boolean> {
  if (!isValidLetterId(letterId)) return false;

  const db = await getDb();
  const result = await db.runAsync(
    'UPDATE letters SET read_at = ? WHERE letter_id = ? AND read_at IS NULL',
    [at, letterId],
  );
  return result.changes > 0;
}

export async function markLetterUnread(letterId: string): Promise<boolean> {
  if (!isValidLetterId(letterId)) return false;

  const db = await getDb();
  const result = await db.runAsync(
    'UPDATE letters SET read_at = NULL WHERE letter_id = ? AND read_at IS NOT NULL',
    letterId,
  );
  return result.changes > 0;
}

/** Removes the local cache row only; the server delete is `removeLetter()`. */
export async function removeLetterLocal(letterId: string): Promise<boolean> {
  if (!isValidLetterId(letterId)) return false;

  const db = await getDb();
  const result = await db.runAsync('DELETE FROM letters WHERE letter_id = ?', letterId);
  return result.changes > 0;
}

export async function countUnread(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM letters WHERE read_at IS NULL',
  );
  return row?.count ?? 0;
}

/** Read ids for `mailbox-state.json`. */
export async function listReadLetterIds(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ letter_id: string }>(
    'SELECT letter_id FROM letters WHERE read_at IS NOT NULL ORDER BY sent_at DESC',
  );
  return rows.map((row) => row.letter_id);
}

/**
 * Applies read ids restored from a backup (MAILBOX.md §10).
 *
 * Ids whose letter is already cached are marked read now; the rest are kept in
 * `app_meta` so the next mailbox refetch marks them read when they arrive. Ids
 * that are already read locally are ignored (the local timestamp wins).
 */
export async function mergeReadState(
  letterIds: readonly string[],
  at = Date.now(),
): Promise<{ applied: number; pending: number }> {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const id of letterIds) {
    if (!isValidLetterId(id) || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }

  if (unique.length === 0) return { applied: 0, pending: 0 };

  const db = await getDb();
  let applied = 0;
  let pending = 0;

  await db.withTransactionAsync(async () => {
    const rows: { letter_id: string; read_at: number | null }[] = [];
    for (let start = 0; start < unique.length; start += READ_STATE_ID_CHUNK) {
      const chunk = unique.slice(start, start + READ_STATE_ID_CHUNK);
      const placeholders = chunk.map(() => '?').join(', ');
      rows.push(
        ...(await db.getAllAsync<{ letter_id: string; read_at: number | null }>(
          `SELECT letter_id, read_at FROM letters WHERE letter_id IN (${placeholders})`,
          chunk,
        )),
      );
    }

    const plan = planReadStateMerge(rows, unique);

    if (plan.apply.length > 0) {
      for (let start = 0; start < plan.apply.length; start += READ_STATE_ID_CHUNK) {
        const chunk = plan.apply.slice(start, start + READ_STATE_ID_CHUNK);
        const marks = chunk.map(() => '?').join(', ');
        await db.runAsync(
          `UPDATE letters SET read_at = ? WHERE letter_id IN (${marks}) AND read_at IS NULL`,
          [at, ...chunk],
        );
      }
      applied = plan.apply.length;
    }

    const existingPending = await readPendingReadIds(db);
    const merged = [...new Set([...existingPending, ...plan.pending])].slice(
      0,
      MAX_PENDING_READ_IDS,
    );
    pending = merged.length;
    await writePendingReadIds(db, merged);
  });

  return { applied, pending };
}
