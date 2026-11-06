import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BACKUP_FORMAT,
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
  type BackupProfileFile,
} from '../src/lib/backup';
import type { ContactRow, RecipeRow } from '../src/db/types';

function row(overrides: Partial<RecipeRow> = {}): RecipeRow {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    title: 'Feijão',
    file_path: 'recipes/11111111-2222-4333-8444-555555555555.md',
    step_count: 12,
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_050_000,
    deleted_at: null,
    source_share_id: null,
    source_name: null,
    source_seal: null,
    imported_at: null,
    content_hash: 'a'.repeat(64),
    pinned: 0,
    ...overrides,
  };
}

function entry(overrides: Partial<BackupEntry> = {}): BackupEntry {
  return {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    title: 'Bolo',
    step_count: 3,
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_100_000,
    pinned: 0,
    source_share_id: null,
    source_name: null,
    source_seal: null,
    imported_at: null,
    content_hash: 'b'.repeat(64),
    ...overrides,
  };
}

function index(recipes: BackupEntry[]) {
  return { format: BACKUP_FORMAT, exportedAt: 1_762_300_000_000, recipes };
}

test('buildIndex documents the v1 shape and drops trashed recipes', () => {
  const built = buildIndex(
    [row({ pinned: 1 }), row({ id: 'deleted-id', deleted_at: 1_700_000_200_000 })],
    1_762_300_000_000,
  );

  assert.equal(built.format, 1);
  assert.equal(built.exportedAt, 1_762_300_000_000);
  assert.equal(built.recipes.length, 1);
  assert.deepEqual(built.recipes[0], {
    id: '11111111-2222-4333-8444-555555555555',
    title: 'Feijão',
    step_count: 12,
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_050_000,
    pinned: 1,
    source_share_id: null,
    source_name: null,
    source_seal: null,
    imported_at: null,
    content_hash: 'a'.repeat(64),
  });
});

test('buildIndex keeps import provenance', () => {
  const built = buildIndex([
    row({
      source_share_id: 'f8k2m9x1q4',
      source_name: 'Lucas',
      source_seal: '{"kind":"sigil","id":"cat"}',
      imported_at: 1_700_000_300_000,
    }),
  ]);

  assert.equal(built.recipes[0]?.source_share_id, 'f8k2m9x1q4');
  assert.equal(built.recipes[0]?.source_name, 'Lucas');
  assert.equal(built.recipes[0]?.source_seal, '{"kind":"sigil","id":"cat"}');
  assert.equal(built.recipes[0]?.imported_at, 1_700_000_300_000);
});

test('recipeEntryPath matches the documented zip layout', () => {
  assert.equal(INDEX_FILE, 'recipe-index.json');
  assert.equal(recipeEntryPath('abc'), 'recipes/abc.md');
});

test('parseIndex accepts a valid index and ignores unknown fields', () => {
  const parsed = parseIndex({
    ...index([entry()]),
    future_field: 'ignored',
    recipes: [{ ...entry(), extra: { nested: true } }],
  });

  assert.deepEqual(parsed, index([entry()]));
});

test('parseIndex accepts an empty archive', () => {
  assert.deepEqual(parseIndex(index([])), index([]));
});

test('parseIndex rejects a corrupt or unsupported index', () => {
  assert.equal(parseIndex(null), null);
  assert.equal(parseIndex('not json'), null);
  assert.equal(parseIndex([]), null);
  assert.equal(parseIndex({}), null);
  assert.equal(parseIndex({ ...index([]), format: 2 }), null);
  assert.equal(parseIndex({ ...index([]), format: '1' }), null);
  assert.equal(parseIndex({ format: 1, recipes: [] }), null);
  assert.equal(parseIndex({ ...index([]), recipes: 'nope' }), null);
  assert.equal(parseIndex({ ...index([]), exportedAt: -1 }), null);
});

test('parseIndex rejects malformed entries', () => {
  const bad: unknown[] = [
    null,
    'entry',
    entry({ id: '../escape' }),
    entry({ id: '' }),
    entry({ title: '' }),
    entry({ title: '   ' }),
    entry({ step_count: -1 }),
    entry({ step_count: 1.5 }),
    entry({ created_at: '1700000000000' as unknown as number }),
    entry({ created_at: 2, updated_at: 1 }),
    entry({ pinned: 2 as unknown as number }),
    entry({ source_name: 42 as unknown as string }),
    entry({ imported_at: 1.5 }),
    entry({ content_hash: '' }),
  ];

  for (const value of bad) {
    assert.equal(parseIndex(index([value as BackupEntry])), null, JSON.stringify(value));
  }
});

test('parseIndex rejects duplicate ids', () => {
  assert.equal(parseIndex(index([entry(), entry()])), null);
});

test('planImport inserts everything into an empty library', () => {
  const plan = planImport([], index([entry()]));

  assert.deepEqual(plan, {
    toInsert: [entry().id],
    existing: [],
    missingFiles: [],
  });
});

test('planImport never overwrites a local id', () => {
  const keep = entry({ id: 'local-id', title: 'Local' });
  const incoming = entry({ id: 'local-id', title: 'Do backup' });

  const plan = planImport([{ id: 'local-id' }], index([incoming, entry()]));

  assert.deepEqual(plan.existing, [keep.id]);
  assert.deepEqual(plan.toInsert, [entry().id]);
  assert.deepEqual(plan.missingFiles, []);
});

test('planImport reports entries whose body file is missing', () => {
  const withFile = entry({ id: 'with-file' });
  const withoutFile = entry({ id: 'without-file' });

  const plan = planImport([], index([withFile, withoutFile]), ['with-file']);

  assert.deepEqual(plan.toInsert, ['with-file']);
  assert.deepEqual(plan.missingFiles, ['without-file']);
  assert.deepEqual(plan.existing, []);
});

test('planImport treats an existing id as existing even when its file is missing', () => {
  const plan = planImport([{ id: 'local' }], index([entry({ id: 'local' })]), []);

  assert.deepEqual(plan.existing, ['local']);
  assert.deepEqual(plan.missingFiles, []);
  assert.deepEqual(plan.toInsert, []);
});

test('planImport handles an empty archive', () => {
  assert.deepEqual(planImport([{ id: 'local' }], index([])), {
    toInsert: [],
    existing: [],
    missingFiles: [],
  });
});

test('isBackupEntryName accepts only the documented zip layout', () => {
  assert.equal(isBackupEntryName(INDEX_FILE), true);
  assert.equal(isBackupEntryName('recipe-index.json'), true);
  assert.equal(isBackupEntryName('recipes/abc.md'), true);
  assert.equal(isBackupEntryName('recipes/11111111-2222-4333-8444-555555555555.md'), true);
  assert.equal(isBackupEntryName(`recipes/${'a'.repeat(64)}.md`), true);
});

test('isBackupEntryName rejects traversal, nesting, and unexpected names', () => {
  const bad = [
    '../escape.md',
    'recipes/../x.md',
    'recipes/a/b.md',
    'other.json',
    'recipes/.md',
    'recipes/ with space.md',
    ' recipes/abc.md',
    'recipes/abc.md ',
    'recipes/abc.markdown',
    'recipe-index.json.bak',
    'recipes/abc.MD',
    `recipes/${'a'.repeat(65)}.md`,
    'recipes/abc!.md',
    '',
  ];

  for (const name of bad) {
    assert.equal(isBackupEntryName(name), false, name);
  }
});

test('entrySizeLimit caps the index at 8 MB and bodies at 64 KB', () => {
  assert.equal(entrySizeLimit(INDEX_FILE), 8 * 1024 * 1024);
  assert.equal(entrySizeLimit('recipes/abc.md'), 64 * 1024);
  assert.equal(entrySizeLimit('../escape.md'), 0);
  assert.equal(entrySizeLimit('other.json'), 0);
  assert.equal(entrySizeLimit('recipes/.md'), 0);
});

test('import guards are the shared zip-bomb limits', () => {
  assert.equal(MAX_IMPORT_ENTRIES, 5000);
  assert.equal(MAX_IMPORT_UNCOMPRESSED_BYTES, 200 * 1024 * 1024);
});

/* ------------------------------------------------------------------ */
/* Optional mailbox entries                                            */
/* ------------------------------------------------------------------ */

function contactRow(overrides: Partial<ContactRow> = {}): ContactRow {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    mailbox_address: 'k7m2x9q4p8r3',
    display_name: 'Lucas',
    seal_json: '{"kind":"sigil","id":"cat"}',
    created_at: 1_700_000_000_000,
    last_sent_at: null,
    ...overrides,
  };
}

function contactEntry(overrides: Partial<BackupContactEntry> = {}): BackupContactEntry {
  return {
    address: 'k7m2x9q4p8r3',
    displayName: 'Lucas',
    seal: { kind: 'sigil', id: 'cat' },
    createdAt: 1_700_000_000_000,
    lastSentAt: null,
    ...overrides,
  };
}

const PROFILE: BackupProfileFile = {
  displayName: 'Ana',
  seal: { kind: 'sigil', id: 'moon' },
  mailbox: { address: 'k7m2x9q4p8r3', secret: 'a'.repeat(64) },
};

test('the new mailbox entries are part of the archive layout', () => {
  assert.equal(PROFILE_FILE, 'profile.json');
  assert.equal(MAILBOX_STATE_FILE, 'mailbox-state.json');
  assert.equal(CONTACTS_FILE, 'contacts.json');

  for (const name of [PROFILE_FILE, MAILBOX_STATE_FILE, CONTACTS_FILE]) {
    assert.equal(isBackupEntryName(name), true, name);
    assert.ok(entrySizeLimit(name) > 0, name);
  }

  assert.equal(entrySizeLimit(PROFILE_FILE), 128 * 1024);
  assert.equal(entrySizeLimit(MAILBOX_STATE_FILE), 1024 * 1024);
  assert.equal(entrySizeLimit(CONTACTS_FILE), 256 * 1024);

  for (const name of ['Profile.json', 'profile.json.bak', 'mailbox-state', 'contacts']) {
    assert.equal(isBackupEntryName(name), false, name);
    assert.equal(entrySizeLimit(name), 0, name);
  }
});

test('buildProfileFile records the identity and decodes the stored seal', () => {
  assert.deepEqual(
    buildProfileFile(
      { displayName: ' Ana ', sealJson: '{"kind":"sigil","id":"moon"}' },
      { address: 'K7M2X9Q4P8R3', secret: 'A'.repeat(64) },
    ),
    PROFILE,
  );
});

test('buildProfileFile degrades safely without a seal or mailbox', () => {
  assert.deepEqual(buildProfileFile({ displayName: '', sealJson: null }, null), {
    displayName: '',
    seal: null,
    mailbox: null,
  });

  assert.equal(
    buildProfileFile({ displayName: 'Ana', sealJson: '{"kind":"nope"}' }, null).seal,
    null,
  );
  assert.equal(
    buildProfileFile({ displayName: 'Ana', sealJson: null }, {
      address: 'bad',
      secret: 'a'.repeat(64),
    }).mailbox,
    null,
  );
});

test('parseProfileFile round-trips a valid file and normalizes values', () => {
  assert.deepEqual(parseProfileFile(PROFILE), PROFILE);

  assert.deepEqual(
    parseProfileFile({
      displayName: ' Ana ',
      seal: { kind: 'sigil', id: 'moon' },
      mailbox: { address: 'K7M2X9Q4P8R3', secret: 'A'.repeat(64) },
      future: 'ignored',
    }),
    PROFILE,
  );

  assert.deepEqual(parseProfileFile({ displayName: '' }), {
    displayName: '',
    seal: null,
    mailbox: null,
  });
});

test('parseProfileFile rejects a corrupt identity file', () => {
  const bad: unknown[] = [
    null,
    'profile',
    [],
    { seal: null },
    { displayName: 42 },
    { displayName: 'A'.repeat(41) },
    { displayName: 'Ana', seal: { kind: 'nope' } },
    { displayName: 'Ana', mailbox: { address: 'bad', secret: 'a'.repeat(64) } },
    { displayName: 'Ana', mailbox: { address: 'k7m2x9q4p8r3', secret: 'short' } },
    { displayName: 'Ana', mailbox: 'k7m2x9q4p8r3' },
  ];

  for (const value of bad) {
    assert.equal(parseProfileFile(value), null, JSON.stringify(value));
  }
});

test('buildMailboxState keeps only valid, unique read ids', () => {
  assert.deepEqual(
    buildMailboxState([
      'k8m2x9q4pabc',
      'k8m2x9q4pabc',
      'not-an-id',
      'L8K2M9X4QABC',
      'm8k2m9x4qabc',
    ]),
    { readLetterIds: ['k8m2x9q4pabc', 'm8k2m9x4qabc'] },
  );
});

test('parseMailboxState is strict about read ids', () => {
  assert.deepEqual(parseMailboxState({ readLetterIds: [] }), { readLetterIds: [] });
  assert.deepEqual(parseMailboxState({ readLetterIds: ['k8m2x9q4pabc'] }), {
    readLetterIds: ['k8m2x9q4pabc'],
  });

  const bad: unknown[] = [
    null,
    [],
    {},
    { readLetterIds: 'k8m2x9q4pabc' },
    { readLetterIds: [42] },
    { readLetterIds: ['not-an-id'] },
  ];

  for (const value of bad) {
    assert.equal(parseMailboxState(value), null, JSON.stringify(value));
  }
});

test('buildContactsFile records contacts without secrets', () => {
  assert.deepEqual(buildContactsFile([contactRow()]), [contactEntry()]);

  const entries = buildContactsFile([
    contactRow(),
    contactRow(),
    contactRow({ mailbox_address: 'bad', display_name: 'Bad' }),
    contactRow({ display_name: '   ' }),
  ]);
  assert.deepEqual(entries, [contactEntry()]);
  assert.equal('secret' in (entries[0] ?? {}), false);
});

test('parseContactsFile skips malformed rows and duplicates', () => {
  assert.equal(parseContactsFile(null), null);
  assert.equal(parseContactsFile({ contacts: [] }), null);

  const parsed = parseContactsFile([
    contactEntry(),
    contactEntry(),
    { address: 'bad', displayName: 'Bad', createdAt: 1 },
    { address: 'k7m2x9q4p8r3', displayName: 'Ana', createdAt: 'nope' },
    { address: 'm8k2m9x4qabc', displayName: 'Bia', createdAt: 2, lastSentAt: 3 },
    'nope',
  ]);

  assert.deepEqual(parsed, [
    contactEntry(),
    { address: 'm8k2m9x4qabc', displayName: 'Bia', seal: null, createdAt: 2, lastSentAt: 3 },
  ]);
});

test('planContactsMerge keeps local contacts and adds new addresses', () => {
  const plan = planContactsMerge(
    [contactRow(), contactRow({ mailbox_address: 'm8k2m9x4qabc', display_name: 'Local Bia' })],
    [
      contactEntry({ displayName: 'Do backup' }),
      contactEntry({ address: 'm8k2m9x4qabc', displayName: 'Do backup' }),
      contactEntry({ address: 'n8k2m9x4qabc', displayName: 'Nina' }),
      contactEntry({ address: 'n8k2m9x4qabc', displayName: 'Nina again' }),
    ],
  );

  assert.deepEqual(plan.toInsert, [
    contactEntry({ address: 'n8k2m9x4qabc', displayName: 'Nina' }),
  ]);
  assert.equal(plan.skipped, 3);
});

test('shouldRestoreMailbox only adopts into an empty mailbox table', () => {
  assert.equal(shouldRestoreMailbox(false), true);
  assert.equal(shouldRestoreMailbox(true), false);
});

test('a v1 archive without the optional entries still parses', () => {
  const legacy = index([entry()]);
  assert.deepEqual(parseIndex(legacy), legacy);
});
