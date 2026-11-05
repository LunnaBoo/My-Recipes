import type { RecipeRow } from '../db/types';

/**
 * Backup format v1 (SPEC.md §9).
 *
 * A backup is a zip with a single index file and one markdown file per recipe:
 *
 *   recipe-index.json
 *   recipes/<id>.md
 *
 * Only this module defines the wire shape; the zip/IO side lives in
 * `backupFile.ts`. Everything here is pure so it can be tested in Node.
 */

export const BACKUP_FORMAT = 1;
export const INDEX_FILE = 'recipe-index.json';
export const RECIPES_PREFIX = 'recipes/';

/**
 * Ids come from an archive, and they become file names on import, so they are
 * restricted to the URL-safe alphabet used by UUIDs and share ids. This also
 * rules out `..` and `/` path traversal.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TITLE_LENGTH = 120;

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
