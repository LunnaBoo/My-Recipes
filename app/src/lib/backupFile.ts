import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import {
  addContact,
  getMailbox,
  listContacts,
  listReadLetterIds,
  mergeReadState,
  saveMailbox,
} from '../db/mailboxRepository';
import {
  getProfile,
  insertImportedRecipe,
  listRecipeIds,
  listRecipes,
  saveProfile,
} from '../db/repository';
import { ptBR } from '../i18n/pt-BR';
import { readBody } from '../storage/bodies';
import {
  CONTACTS_FILE,
  INDEX_FILE,
  MAILBOX_STATE_FILE,
  MAX_IMPORT_ENTRIES,
  MAX_IMPORT_UNCOMPRESSED_BYTES,
  PROFILE_FILE,
  buildContactsFile,
  buildIndex,
  buildMailboxState,
  buildProfileFile,
  entrySizeLimit,
  isBackupEntryName,
  parseContactsFile,
  parseIndex,
  parseMailboxState,
  parseProfileFile,
  planContactsMerge,
  planImport,
  recipeEntryPath,
  shouldRestoreMailbox,
  type BackupContactEntry,
  type BackupEntry,
  type BackupMailboxStateFile,
  type BackupProfileFile,
} from './backup';
import { contentHash } from './contentHash';
import { sealToStored } from './seal';

/** Hard cap for an imported archive (SPEC.md §9 does not set one; 50 MB is plenty). */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

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
  /** Mailbox additions (MAILBOX.md §10); recipe-only callers can ignore them. */
  mailboxRestored: boolean;
  mailboxAlreadySet: boolean;
  profileRestored: boolean;
  contactsAdded: number;
  readIdsMerged: number;
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
 * Exports every non-deleted recipe as `recipe-index.json` + `recipes/<id>.md`,
 * plus the optional `profile.json`, `mailbox-state.json` and `contacts.json`,
 * and hands the zip to the system share sheet.
 *
 * With no recipes and no mailbox identity there is nothing worth sharing: the
 * call resolves with `{ count: 0, shared: false }` and the caller shows an
 * inline message. A mailbox alone is exported, because losing it on reinstall
 * would also lose the address people send letters to.
 */
export async function exportBackup(now = new Date()): Promise<ExportResult> {
  let rows: Awaited<ReturnType<typeof listRecipes>>;
  let mailbox: Awaited<ReturnType<typeof getMailbox>>;
  let contacts: Awaited<ReturnType<typeof listContacts>>;
  let profile: Awaited<ReturnType<typeof getProfile>>;
  let readIds: string[];

  try {
    rows = await listRecipes();
    mailbox = await getMailbox();
    contacts = await listContacts();
    profile = await getProfile();
    readIds = await listReadLetterIds();
  } catch {
    throw new BackupError('write', ptBR.backupExportFailed);
  }

  // A mailbox identity is worth a backup even with no recipes yet: without it a
  // reinstall loses the address and every letter sent to it. Contacts alone
  // are not (they are re-addable), so they do not force an export.
  if (rows.length === 0 && mailbox === null) return { count: 0, shared: false };

  const index = buildIndex(rows, now.getTime());

  const files: Record<string, Uint8Array> = {
    [INDEX_FILE]: strToU8(JSON.stringify(index)),
    [PROFILE_FILE]: strToU8(JSON.stringify(buildProfileFile(profile, mailbox))),
    [MAILBOX_STATE_FILE]: strToU8(JSON.stringify(buildMailboxState(readIds))),
    [CONTACTS_FILE]: strToU8(JSON.stringify(buildContactsFile(contacts))),
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
 * Reads and parses one optional entry. A missing or unreadable entry is simply
 * absent: backups written before the mailbox existed stay importable.
 */
function parseOptionalEntry<T>(
  entries: Record<string, Uint8Array>,
  name: string,
  parse: (json: unknown) => T | null,
): T | null {
  const bytes = entries[name];
  if (!bytes) return null;

  try {
    return parse(JSON.parse(strFromU8(bytes)));
  } catch {
    return null;
  }
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
  let rejected: 'invalid' | 'size' | null = null;
  let uncompressedTotal = 0;
  let entryCount = 0;

  try {
    entries = unzipSync(bytes, {
      // Runs on the central directory, before any entry is decompressed: a
      // hostile archive is refused without ever inflating its contents.
      filter: (file) => {
        entryCount += 1;
        if (entryCount > MAX_IMPORT_ENTRIES) {
          rejected = 'invalid';
          return false;
        }

        // Extra files (a `.DS_Store`, a directory entry, or a traversal path)
        // are skipped, never decompressed. Only the documented backup layout
        // is ever read.
        if (!isBackupEntryName(file.name)) return false;

        const limit = entrySizeLimit(file.name);
        if (file.originalSize > limit) {
          rejected = 'size';
          return false;
        }

        uncompressedTotal += file.originalSize;
        if (uncompressedTotal > MAX_IMPORT_UNCOMPRESSED_BYTES) {
          rejected = 'size';
          return false;
        }

        return true;
      },
    });
  } catch {
    throw new BackupError('invalid-archive', ptBR.backupInvalidArchive);
  }

  if (rejected === 'size') {
    throw new BackupError('too-large', ptBR.backupTooLarge);
  }
  if (rejected === 'invalid') {
    throw new BackupError('invalid-archive', ptBR.backupInvalidArchive);
  }

  const names = Object.keys(entries);
  if (names.length > MAX_IMPORT_ENTRIES) {
    throw new BackupError('invalid-archive', ptBR.backupInvalidArchive);
  }
  const totalBytes = names.reduce((sum, name) => sum + (entries[name]?.byteLength ?? 0), 0);
  if (totalBytes > MAX_IMPORT_UNCOMPRESSED_BYTES) {
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

  // Optional mailbox entries: an archive from an older app does not have them,
  // and a corrupt optional entry must not block the recipe import.
  const profile = parseOptionalEntry<BackupProfileFile>(entries, PROFILE_FILE, parseProfileFile);
  const mailboxState = parseOptionalEntry<BackupMailboxStateFile>(
    entries,
    MAILBOX_STATE_FILE,
    parseMailboxState,
  );
  const contacts = parseOptionalEntry<BackupContactEntry[]>(
    entries,
    CONTACTS_FILE,
    parseContactsFile,
  );

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

  // Mailbox identity and profile: adopt only into an empty mailbox table, so a
  // backup can never replace the identity this device already uses.
  let mailboxRestored = false;
  let mailboxAlreadySet = false;
  let profileRestored = false;

  try {
    const localMailbox = await getMailbox();
    const canRestore = shouldRestoreMailbox(localMailbox !== null);
    mailboxAlreadySet = !canRestore && profile?.mailbox !== null && profile?.mailbox !== undefined;

    if (profile && canRestore) {
      if (profile.mailbox) {
        await saveMailbox({
          address: profile.mailbox.address,
          secret: profile.mailbox.secret,
          registeredAt: Date.now(),
        });
        mailboxRestored = true;
      }

      if (profile.displayName.length > 0 || profile.seal) {
        await saveProfile({
          displayName: profile.displayName,
          sealJson: profile.seal ? sealToStored(profile.seal) : null,
        });
        profileRestored = true;
      }
    }
  } catch (error) {
    throw toImportError(error);
  }

  // Contacts: merge by address, local wins.
  let contactsAdded = 0;
  try {
    const localContacts = await listContacts();
    const contactPlan = planContactsMerge(localContacts, contacts ?? []);

    for (const contact of contactPlan.toInsert) {
      await addContact({
        address: contact.address,
        displayName: contact.displayName,
        sealJson: contact.seal ? sealToStored(contact.seal) : null,
        createdAt: contact.createdAt,
        lastSentAt: contact.lastSentAt,
      });
      contactsAdded += 1;
    }
  } catch (error) {
    throw toImportError(error);
  }

  // Read state: applies to cached letters now and stays pending for letters the
  // next mailbox refetch brings in.
  let readIdsMerged = 0;
  try {
    if (mailboxState) {
      const merged = await mergeReadState(mailboxState.readLetterIds);
      readIdsMerged = merged.applied;
    }
  } catch (error) {
    throw toImportError(error);
  }

  return {
    inserted,
    existing: plan.existing.length + skipped,
    missingFiles: plan.missingFiles.length,
    mailboxRestored,
    mailboxAlreadySet,
    profileRestored,
    contactsAdded,
    readIdsMerged,
  };
}
