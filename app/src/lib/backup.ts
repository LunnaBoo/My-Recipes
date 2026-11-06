import type { ContactRow, RecipeRow } from '../db/types';
import {
  MAX_PROFILE_NAME_LENGTH,
  isValidLetterId,
  normalizeContactName,
  normalizeMailboxSecret,
  parseMailboxAddress,
} from './mailbox';
import { parseSeal, sealFromStored, type Seal } from './seal';

/**
 * Backup format v1 (SPEC.md §9, MAILBOX.md §10).
 *
 * A backup is a zip with a single index file and one markdown file per recipe:
 *
 *   recipe-index.json
 *   recipes/<id>.md
 *
 * Since the mailbox it also carries three optional entries, which older app
 * versions ignore and newer ones tolerate when absent:
 *
 *   profile.json        { displayName, seal, mailbox: { address, secret } | null }
 *   mailbox-state.json  { readLetterIds: string[] }
 *   contacts.json       contact rows, no secrets
 *
 * Only this module defines the wire shape; the zip/IO side lives in
 * `backupFile.ts`. Everything here is pure so it can be tested in Node.
 */

export const BACKUP_FORMAT = 1;
export const INDEX_FILE = 'recipe-index.json';
export const RECIPES_PREFIX = 'recipes/';
export const PROFILE_FILE = 'profile.json';
export const MAILBOX_STATE_FILE = 'mailbox-state.json';
export const CONTACTS_FILE = 'contacts.json';

/**
 * Ids come from an archive, and they become file names on import, so they are
 * restricted to the URL-safe alphabet used by UUIDs and share ids. This also
 * rules out `..` and `/` path traversal.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TITLE_LENGTH = 120;

/** Zip-bomb guards shared with `backupFile.ts`, which applies them before decompressing. */
export const MAX_IMPORT_ENTRIES = 5000;
export const MAX_IMPORT_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;

/** Generous cap for the index: 5000 entries of a few hundred bytes each. */
const MAX_INDEX_BYTES = 8 * 1024 * 1024;
/** Matches the body limit enforced by the repository (64 KB of UTF-8). */
const MAX_BODY_BYTES = 64 * 1024;
/** `profile.json` carries the seal, at most a 32 KB image as base64. */
const MAX_PROFILE_BYTES = 128 * 1024;
/** 500 read ids of 12 chars each, with JSON punctuation and headroom. */
const MAX_MAILBOX_STATE_BYTES = 1024 * 1024;
/** A few hundred contacts with a stored seal snapshot each. */
const MAX_CONTACTS_BYTES = 256 * 1024;

export type BackupEntry = {
  id: string;
  title: string;
  step_count: number;
  created_at: number;
  updated_at: number;
  pinned: number;
  source_share_id: string | null;
  source_name: string | null;
  source_seal: string | null;
  imported_at: number | null;
  content_hash: string;
};

export type BackupIndex = {
  format: number;
  exportedAt: number;
  recipes: BackupEntry[];
};

export type ImportPlan = {
  /** Ids that are not local and whose body file is present in the archive. */
  toInsert: string[];
  /** Ids that already exist locally; never overwritten. */
  existing: string[];
  /** Incoming ids whose `recipes/<id>.md` entry is absent. */
  missingFiles: string[];
};

/** Zip entry name for a recipe body. */
export function recipeEntryPath(id: string): string {
  return `${RECIPES_PREFIX}${id}.md`;
}

/**
 * True only for the entry shapes a v1 backup may contain: the index file, one
 * of the optional mailbox files, or `recipes/<id>.md` with an id that cannot
 * traverse paths.
 *
 * The import filter runs this before decompression, so an archive can never
 * smuggle in an unexpected name (or a `..` path) and have it unpacked.
 */
export function isBackupEntryName(name: string): boolean {
  if (name === INDEX_FILE) return true;
  if (name === PROFILE_FILE || name === MAILBOX_STATE_FILE || name === CONTACTS_FILE) {
    return true;
  }
  if (!name.startsWith(RECIPES_PREFIX) || !name.endsWith('.md')) return false;

  const id = name.slice(RECIPES_PREFIX.length, -'.md'.length);
  return ID_PATTERN.test(id);
}

/** Uncompressed size cap for one entry; 0 for names that are not part of a backup. */
export function entrySizeLimit(name: string): number {
  if (name === INDEX_FILE) return MAX_INDEX_BYTES;
  if (name === PROFILE_FILE) return MAX_PROFILE_BYTES;
  if (name === MAILBOX_STATE_FILE) return MAX_MAILBOX_STATE_BYTES;
  if (name === CONTACTS_FILE) return MAX_CONTACTS_BYTES;
  if (isBackupEntryName(name)) return MAX_BODY_BYTES;
  return 0;
}

/**
 * Builds the index for an export. Trashed recipes are excluded even if the
 * caller passes them in; files are the caller's job.
 */
export function buildIndex(rows: readonly RecipeRow[], exportedAt = Date.now()): BackupIndex {
  return {
    format: BACKUP_FORMAT,
    exportedAt,
    recipes: rows.filter((row) => row.deleted_at === null).map(toEntry),
  };
}

function toEntry(row: RecipeRow): BackupEntry {
  return {
    id: row.id,
    title: row.title,
    step_count: row.step_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
    pinned: row.pinned,
    source_share_id: row.source_share_id,
    source_name: row.source_name,
    source_seal: row.source_seal,
    imported_at: row.imported_at,
    content_hash: row.content_hash,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isNullableString(value: unknown): value is string | null {
  // `source_seal` can carry a 32 KB image seal as base64 JSON (~44 KB), so this
  // bound follows the 128 KB share payload limit rather than a short label.
  return value === null || (typeof value === 'string' && value.length <= 128 * 1024);
}

function isTitle(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.trim().length <= MAX_TITLE_LENGTH
  );
}

function parseEntry(value: unknown): BackupEntry | null {
  if (!isRecord(value)) return null;

  const {
    id,
    title,
    step_count: stepCount,
    created_at: createdAt,
    updated_at: updatedAt,
    pinned,
    source_share_id: sourceShareId,
    source_name: sourceName,
    source_seal: sourceSeal,
    imported_at: importedAt,
    content_hash: contentHash,
  } = value;

  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null;
  if (!isTitle(title)) return null;
  if (!isInteger(stepCount)) return null;
  if (!isInteger(createdAt) || !isInteger(updatedAt)) return null;
  if (pinned !== 0 && pinned !== 1) return null;
  if (!isNullableString(sourceShareId)) return null;
  if (!isNullableString(sourceName)) return null;
  if (!isNullableString(sourceSeal)) return null;
  if (importedAt !== null && !isInteger(importedAt)) return null;
  if (typeof contentHash !== 'string' || contentHash.length === 0) return null;
  if (createdAt > updatedAt) return null;

  return {
    id,
    title,
    step_count: stepCount,
    created_at: createdAt,
    updated_at: updatedAt,
    pinned,
    source_share_id: sourceShareId,
    source_name: sourceName,
    source_seal: sourceSeal,
    imported_at: importedAt,
    content_hash: contentHash,
  };
}

/**
 * Strict validation for a parsed `recipe-index.json`.
 *
 * Unknown fields are ignored (forward compatibility), but a wrong format
 * version, a malformed entry, or a duplicated id rejects the whole index: an
 * archive we cannot fully understand is never half-imported.
 */
export function parseIndex(json: unknown): BackupIndex | null {
  if (!isRecord(json)) return null;
  if (json.format !== BACKUP_FORMAT) return null;
  if (!isInteger(json.exportedAt)) return null;
  if (!Array.isArray(json.recipes)) return null;

  const recipes: BackupEntry[] = [];
  const seen = new Set<string>();

  for (const raw of json.recipes) {
    const entry = parseEntry(raw);
    if (!entry) return null;
    if (seen.has(entry.id)) return null;
    seen.add(entry.id);
    recipes.push(entry);
  }

  return { format: BACKUP_FORMAT, exportedAt: json.exportedAt, recipes };
}

/**
 * Merge rule: local data wins. An id that exists locally is reported as
 * `existing` and never written, even when the archive carries a newer copy.
 *
 * `availableFileIds` is the set of ids that have a `recipes/<id>.md` entry in
 * the archive. When it is omitted every entry is assumed to have a body (index
 * planning only). `missingFiles` only lists entries that would otherwise be
 * imported: an id that is already local is reported once, as `existing`.
 */
export function planImport(
  localSummaries: readonly { id: string }[],
  incomingIndex: BackupIndex,
  availableFileIds?: Iterable<string>,
): ImportPlan {
  const local = new Set(localSummaries.map((summary) => summary.id));
  const files = availableFileIds ? new Set(availableFileIds) : null;

  const toInsert: string[] = [];
  const existing: string[] = [];
  const missingFiles: string[] = [];

  for (const entry of incomingIndex.recipes) {
    if (local.has(entry.id)) {
      existing.push(entry.id);
      continue;
    }

    if (files && !files.has(entry.id)) {
      missingFiles.push(entry.id);
      continue;
    }

    toInsert.push(entry.id);
  }

  return { toInsert, existing, missingFiles };
}

/* ------------------------------------------------------------------ */
/* Optional mailbox entries (MAILBOX.md §10)                           */
/* ------------------------------------------------------------------ */

export type BackupMailboxIdentity = {
  address: string;
  secret: string;
};

export type BackupProfileFile = {
  displayName: string;
  /** Decoded seal, or null when the profile has none. */
  seal: Seal | null;
  mailbox: BackupMailboxIdentity | null;
};

export type BackupMailboxStateFile = {
  readLetterIds: string[];
};

/** One contact row as stored in `contacts.json`; never carries a secret. */
export type BackupContactEntry = {
  address: string;
  displayName: string;
  seal: Seal | null;
  createdAt: number;
  lastSentAt: number | null;
};

function parseBackupMailbox(value: unknown): BackupMailboxIdentity | null {
  if (!isRecord(value)) return null;

  const address = parseMailboxAddress(typeof value.address === 'string' ? value.address : '');
  const secret = normalizeMailboxSecret(typeof value.secret === 'string' ? value.secret : '');
  if (!address || !secret) return null;

  return { address, secret };
}

/** Builds `profile.json` from the local profile row and identity singleton. */
export function buildProfileFile(
  profile: { displayName: string; sealJson: string | null },
  mailbox: { address: string; secret: string } | null,
): BackupProfileFile {
  const address = mailbox ? parseMailboxAddress(mailbox.address) : null;
  const secret = mailbox ? normalizeMailboxSecret(mailbox.secret) : null;

  return {
    // Match the server cap so a legacy local name cannot make our own
    // profile.json unreadable on restore.
    displayName: profile.displayName.trim().slice(0, 40),
    seal: sealFromStored(profile.sealJson),
    mailbox: address && secret ? { address, secret } : null,
  };
}

/**
 * Strict parser for `profile.json`.
 *
 * The mailbox identity is the sensitive part: an invalid address or secret
 * rejects the file instead of restoring a broken identity. An unknown seal
 * shape is also rejected — the profile is decorative, but a corrupt file is a
 * sign the archive was tampered with.
 */
export function parseProfileFile(json: unknown): BackupProfileFile | null {
  if (!isRecord(json)) return null;

  const displayName = json.displayName;
  if (typeof displayName !== 'string') return null;
  if (displayName.trim().length > MAX_PROFILE_NAME_LENGTH) return null;

  const rawSeal = json.seal;
  let seal: Seal | null = null;
  if (rawSeal !== null && rawSeal !== undefined) {
    seal = parseSeal(rawSeal);
    if (!seal) return null;
  }

  const rawMailbox = json.mailbox;
  let mailbox: BackupMailboxIdentity | null = null;
  if (rawMailbox !== null && rawMailbox !== undefined) {
    mailbox = parseBackupMailbox(rawMailbox);
    if (!mailbox) return null;
  }

  return { displayName: displayName.trim(), seal, mailbox };
}

/** Builds `mailbox-state.json`, dropping ids the local schema cannot hold. */
export function buildMailboxState(readLetterIds: readonly string[]): BackupMailboxStateFile {
  const seen = new Set<string>();
  const ids: string[] = [];

  for (const id of readLetterIds) {
    if (!isValidLetterId(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return { readLetterIds: ids };
}

/** Strict parser: one malformed id rejects the file (read state is optional). */
export function parseMailboxState(json: unknown): BackupMailboxStateFile | null {
  if (!isRecord(json)) return null;
  if (!Array.isArray(json.readLetterIds)) return null;

  for (const id of json.readLetterIds) {
    if (!isValidLetterId(id)) return null;
  }

  return buildMailboxState(json.readLetterIds as string[]);
}

/** Builds `contacts.json` from local rows. Secrets are never included. */
export function buildContactsFile(rows: readonly ContactRow[]): BackupContactEntry[] {
  const entries: BackupContactEntry[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const address = parseMailboxAddress(row.mailbox_address);
    const displayName = normalizeContactName(row.display_name);
    if (!address || !displayName) continue;
    if (seen.has(address)) continue;
    seen.add(address);

    entries.push({
      address,
      displayName,
      seal: sealFromStored(row.seal_json),
      createdAt: row.created_at,
      lastSentAt: row.last_sent_at,
    });
  }

  return entries;
}

/**
 * Parser for `contacts.json`. The file must be an array; individual malformed
 * or duplicated rows are skipped so one bad contact cannot lose the rest.
 */
export function parseContactsFile(json: unknown): BackupContactEntry[] | null {
  if (!Array.isArray(json)) return null;

  const entries: BackupContactEntry[] = [];
  const seen = new Set<string>();

  for (const raw of json) {
    if (!isRecord(raw)) continue;

    const address = parseMailboxAddress(typeof raw.address === 'string' ? raw.address : '');
    const displayName = normalizeContactName(
      typeof raw.displayName === 'string' ? raw.displayName : '',
    );
    if (!address || !displayName) continue;
    if (seen.has(address)) continue;

    if (!isInteger(raw.createdAt)) continue;
    if (raw.lastSentAt !== null && raw.lastSentAt !== undefined && !isInteger(raw.lastSentAt)) {
      continue;
    }

    const seal = parseSeal(raw.seal);

    seen.add(address);
    entries.push({
      address,
      displayName,
      seal,
      createdAt: raw.createdAt,
      lastSentAt: typeof raw.lastSentAt === 'number' ? raw.lastSentAt : null,
    });
  }

  return entries;
}

/**
 * Restore rule: a backup adopts its identity only into an empty local mailbox
 * table (MAILBOX.md §10). Importing over an existing mailbox keeps the local
 * identity and reports it as already set.
 */
export function shouldRestoreMailbox(hasLocalMailbox: boolean): boolean {
  return !hasLocalMailbox;
}

/**
 * Contacts merge: local wins by address. Incoming contacts that are not local
 * are inserted in archive order; duplicates inside the archive are collapsed.
 */
export function planContactsMerge(
  local: readonly { mailbox_address: string }[],
  incoming: readonly BackupContactEntry[],
): { toInsert: BackupContactEntry[]; skipped: number } {
  const addresses = new Set<string>();
  for (const row of local) {
    const address = parseMailboxAddress(row.mailbox_address);
    if (address) addresses.add(address);
  }

  const toInsert: BackupContactEntry[] = [];
  let skipped = 0;

  for (const contact of incoming) {
    if (addresses.has(contact.address)) {
      skipped += 1;
      continue;
    }
    addresses.add(contact.address);
    toInsert.push(contact);
  }

  return { toInsert, skipped };
}
