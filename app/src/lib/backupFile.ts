import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import { insertImportedRecipe, listRecipeIds, listRecipes } from '../db/repository';
import { ptBR } from '../i18n/pt-BR';
import { readBody } from '../storage/bodies';
import {
  INDEX_FILE,
  buildIndex,
  parseIndex,
  planImport,
  recipeEntryPath,
  type BackupEntry,
} from './backup';
import { contentHash } from './contentHash';

/** Hard cap for an imported archive (SPEC.md §9 does not set one; 50 MB is plenty). */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
/** Zip-bomb guard: a valid backup of text bodies is far below this. */
const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const MAX_ENTRIES = 5000;

export type BackupErrorCode =
  | 'too-large'
  | 'unreadable'
  | 'invalid-archive'
  | 'share-unavailable'
  | 'write';

/** Typed failure so the settings screen can show a precise pt-BR message. */
export class BackupError extends Error {
  readonly code: BackupErrorCode;

  constructor(code: BackupErrorCode, message: string) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

export type ExportResult = {
  /** Number of recipes in the archive; 0 means nothing was exported. */
  count: number;
  /** False when there was nothing to share. */
  shared: boolean;
};

export type ImportResult = {
  inserted: number;
  existing: number;
  missingFiles: number;
};

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

/** Local calendar date, so the filename matches what the user sees. */
function localDateStamp(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function shareFileName(now: Date): string {
  return `my-recipes-backup-${localDateStamp(now)}.zip`;
}

/**
 * Exports every non-deleted recipe as `recipe-index.json` + `recipes/<id>.md`
 * and hands the zip to the system share sheet.
 *
 * With no recipes there is nothing worth sharing: the call resolves with
 * `{ count: 0, shared: false }` and the caller shows an inline message.
 */
export async function exportBackup(now = new Date()): Promise<ExportResult> {
  let rows: Awaited<ReturnType<typeof listRecipes>>;
  try {
    rows = await listRecipes();
  } catch {
    throw new BackupError('write', ptBR.backupExportFailed);
  }

  if (rows.length === 0) return { count: 0, shared: false };

  const index = buildIndex(rows, now.getTime());

  const files: Record<string, Uint8Array> = {
    [INDEX_FILE]: strToU8(JSON.stringify(index)),
  };

  let bodies: string[];
  try {
    bodies = await Promise.all(rows.map((row) => readBody(row.id)));
  } catch {
    throw new BackupError('write', ptBR.backupExportFailed);
  }

  rows.forEach((row, position) => {
    files[recipeEntryPath(row.id)] = strToU8(bodies[position] ?? '');
  });

  let zipped: Uint8Array;
  try {
    zipped = zipSync(files, { level: 6 });
  } catch {
    throw new BackupError('write', ptBR.backupExportFailed);
  }

  const fileName = shareFileName(now);
  let destination: File;
  try {
    destination = new File(Paths.cache, fileName);
    await destination.write(zipped);
  } catch {
    throw new BackupError('write', ptBR.backupExportFailed);
  }

  let available = false;
  try {
    available = await Sharing.isAvailableAsync();
  } catch {
    available = false;
  }
  if (!available) {
    throw new BackupError('share-unavailable', ptBR.backupShareUnavailable);
  }

  try {
    await Sharing.shareAsync(destination.uri, {
      dialogTitle: ptBR.backupShareDialog,
      mimeType: 'application/zip',
    });
  } catch {
    throw new BackupError('share-unavailable', ptBR.backupShareUnavailable);
  }

  return { count: rows.length, shared: true };
}

function toImportError(error: unknown): BackupError {
  if (error instanceof BackupError) return error;
  return new BackupError('write', ptBR.backupImportFailed);
}

/**
 * Imports a backup chosen with the system file picker.
 *
 * Merge rule: the device always wins. An id that exists locally — including a
 * recipe sitting in the trash — is reported and left untouched. Ids missing
 * their `recipes/<id>.md` entry are skipped and reported too. Nothing is ever
 * deleted or overwritten by an import.
 *
 * Resolves `null` when the user cancels the picker (not an error).
 */
export async function importBackup(): Promise<ImportResult | null> {
  let picked: DocumentPicker.DocumentPickerResult;
  try {
    picked = await DocumentPicker.getDocumentAsync({
      type: ['application/zip', 'application/x-zip-compressed'],
      copyToCacheDirectory: true,
      multiple: false,
    });
  } catch {
    throw new BackupError('unreadable', ptBR.backupUnreadable);
  }

  if (picked.canceled) return null;

  const asset = picked.assets[0];
  if (!asset) throw new BackupError('unreadable', ptBR.backupUnreadable);
  if (typeof asset.size === 'number' && asset.size > MAX_IMPORT_BYTES) {
    throw new BackupError('too-large', ptBR.backupTooLarge);
  }

  let bytes: Uint8Array;
  try {
    bytes = await new File(asset.uri).bytes();
  } catch {
    throw new BackupError('unreadable', ptBR.backupUnreadable);
  }

  if (bytes.byteLength === 0) {
    throw new BackupError('invalid-archive', ptBR.backupInvalidArchive);
  }
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new BackupError('too-large', ptBR.backupTooLarge);
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new BackupError('invalid-archive', ptBR.backupInvalidArchive);
  }

  const names = Object.keys(entries);
  if (names.length > MAX_ENTRIES) {
    throw new BackupError('invalid-archive', ptBR.backupInvalidArchive);
  }
  const totalBytes = names.reduce((sum, name) => sum + (entries[name]?.byteLength ?? 0), 0);
  if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
    throw new BackupError('too-large', ptBR.backupTooLarge);
  }

  const indexBytes = entries[INDEX_FILE];
  if (!indexBytes) {
    throw new BackupError('invalid-archive', ptBR.backupInvalidArchive);
  }

  let json: unknown;
  try {
    json = JSON.parse(strFromU8(indexBytes));
  } catch {
    throw new BackupError('invalid-archive', ptBR.backupInvalidArchive);
  }

  const index = parseIndex(json);
  if (!index) {
    throw new BackupError('invalid-archive', ptBR.backupInvalidArchive);
  }

  // Bodies are decoded once and keyed by id; the same map tells planImport
  // which index entries actually have their markdown file.
  const bodies = new Map<string, string>();
  const availableFileIds: string[] = [];
  for (const entry of index.recipes) {
    const raw = entries[recipeEntryPath(entry.id)];
    if (!raw) continue;
    bodies.set(entry.id, strFromU8(raw));
    availableFileIds.push(entry.id);
  }

  let localIds: string[];
  try {
    localIds = await listRecipeIds();
  } catch {
    throw new BackupError('write', ptBR.backupImportFailed);
  }

  const plan = planImport(
    localIds.map((id) => ({ id })),
    index,
    availableFileIds,
  );

  const entriesById = new Map<string, BackupEntry>(index.recipes.map((entry) => [entry.id, entry]));

  let inserted = 0;
  let skipped = 0;

  for (const id of plan.toInsert) {
    const entry = entriesById.get(id);
    if (!entry) continue;

    const body = bodies.get(id) ?? '';

    try {
      const ok = await insertImportedRecipe({
        id: entry.id,
        title: entry.title,
        stepCount: entry.step_count,
        createdAt: entry.created_at,
        updatedAt: entry.updated_at,
        pinned: entry.pinned,
        sourceShareId: entry.source_share_id,
        sourceName: entry.source_name,
        sourceSeal: entry.source_seal,
        importedAt: entry.imported_at,
        // The body is the source of truth; the index hash is metadata only.
        contentHash: contentHash(body),
        body,
      });
      if (ok) inserted += 1;
      else skipped += 1;
    } catch (error) {
      throw toImportError(error);
    }
  }

  return {
    inserted,
    existing: plan.existing.length + skipped,
    missingFiles: plan.missingFiles.length,
  };
}
