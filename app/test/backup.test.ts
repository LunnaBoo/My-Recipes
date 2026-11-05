import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BACKUP_FORMAT,
  INDEX_FILE,
  buildIndex,
  parseIndex,
  planImport,
  recipeEntryPath,
  type BackupEntry,
} from '../src/lib/backup';
import type { RecipeRow } from '../src/db/types';

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
