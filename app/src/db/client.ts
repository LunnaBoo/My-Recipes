import * as SQLite from 'expo-sqlite';

import { normalizeSearchText } from '../lib/searchText';
import { migrations } from './migrations';

export type SearchMode = 'fts5' | 'like';

const DATABASE_NAME = 'my-recipes.db';

const FTS_SCHEMA = `
  CREATE VIRTUAL TABLE IF NOT EXISTS recipes_fts USING fts5(
    recipe_id UNINDEXED,
    title,
    body,
    tokenize = 'unicode61 remove_diacritics 2'
  );

  CREATE TRIGGER IF NOT EXISTS recipes_fts_ai AFTER INSERT ON recipes BEGIN
    INSERT INTO recipes_fts(recipe_id, title, body)
    VALUES (new.id, new.title, '');
  END;

  CREATE TRIGGER IF NOT EXISTS recipes_fts_au AFTER UPDATE OF title ON recipes BEGIN
    UPDATE recipes_fts SET title = new.title WHERE recipe_id = new.id;
  END;

  CREATE TRIGGER IF NOT EXISTS recipes_fts_ad AFTER DELETE ON recipes BEGIN
    DELETE FROM recipes_fts WHERE recipe_id = old.id;
  END;
`;

/**
 * Index cache used only when the SQLite build has no FTS5. It stores one
 * normalized `title + body` string per recipe so search can stay a plain
 * SQL `LIKE` query instead of scanning files.
 */
const LIKE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS recipes_search_fallback (
    recipe_id TEXT PRIMARY KEY NOT NULL,
    search_text TEXT NOT NULL DEFAULT ''
  );

  CREATE TRIGGER IF NOT EXISTS recipes_search_fallback_ai AFTER INSERT ON recipes BEGIN
    INSERT OR REPLACE INTO recipes_search_fallback(recipe_id, search_text)
    VALUES (new.id, lower(new.title));
  END;

  CREATE TRIGGER IF NOT EXISTS recipes_search_fallback_au AFTER UPDATE OF title ON recipes BEGIN
    UPDATE recipes_search_fallback
    SET search_text = lower(new.title)
    WHERE recipe_id = new.id;
  END;

  CREATE TRIGGER IF NOT EXISTS recipes_search_fallback_ad AFTER DELETE ON recipes BEGIN
    DELETE FROM recipes_search_fallback WHERE recipe_id = old.id;
  END;
`;

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
let searchMode: SearchMode = 'like';

export function getSearchMode(): SearchMode {
  return searchMode;
}

async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;

  for (const migration of migrations) {
    if (migration.version <= version) continue;

    await db.withTransactionAsync(async () => {
      await db.execAsync(migration.sql);
      await db.execAsync(`PRAGMA user_version = ${migration.version}`);
    });

    version = migration.version;
  }
}

async function supportsFts5(db: SQLite.SQLiteDatabase): Promise<boolean> {
  try {
    await db.execAsync('CREATE VIRTUAL TABLE IF NOT EXISTS __fts5_probe USING fts5(value)');
    await db.execAsync('DROP TABLE IF EXISTS __fts5_probe');
    return true;
  } catch {
    return false;
  }
}

async function setUpSearch(db: SQLite.SQLiteDatabase): Promise<SearchMode> {
  const available = await supportsFts5(db);

  if (!available) {
    await db.execAsync(LIKE_SCHEMA);
    await db.execAsync(`
      INSERT OR IGNORE INTO recipes_search_fallback(recipe_id, search_text)
      SELECT id, lower(title) FROM recipes;
    `);
    console.info('[db] FTS5 unavailable — search uses the LIKE fallback');
    return 'like';
  }

  await db.execAsync(FTS_SCHEMA);

  // Backfill titles for rows created before FTS was available (normally none).
  await db.execAsync(`
    INSERT INTO recipes_fts(recipe_id, title, body)
    SELECT r.id, r.title, ''
    FROM recipes r
    WHERE NOT EXISTS (
      SELECT 1 FROM recipes_fts f WHERE f.recipe_id = r.id
    );
  `);

  console.info('[db] FTS5 search active (recipes_fts)');
  return 'fts5';
}

async function initialize(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);

  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');

  await runMigrations(db);
  searchMode = await setUpSearch(db);

  return db;
}

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = initialize();
  }
  return databasePromise;
}

/** Keeps the FTS row in sync with a body stored on disk. */
export async function indexRecipeBody(
  db: SQLite.SQLiteDatabase,
  id: string,
  title: string,
  body: string,
): Promise<void> {
  if (searchMode === 'fts5') {
    const result = await db.runAsync(
      'UPDATE recipes_fts SET title = ?, body = ? WHERE recipe_id = ?',
      title,
      body,
      id,
    );

    if (result.changes === 0) {
      await db.runAsync(
        'INSERT INTO recipes_fts(recipe_id, title, body) VALUES (?, ?, ?)',
        id,
        title,
        body,
      );
    }
    return;
  }

  const searchText = normalizeSearchText(`${title}\n${body}`);
  const result = await db.runAsync(
    'UPDATE recipes_search_fallback SET search_text = ? WHERE recipe_id = ?',
    searchText,
    id,
  );

  if (result.changes === 0) {
    await db.runAsync(
      'INSERT INTO recipes_search_fallback(recipe_id, search_text) VALUES (?, ?)',
      id,
      searchText,
    );
  }
}

/** Converts free text into a safe FTS5 prefix query. */
export function toFtsQuery(query: string): string | null {
  const terms = query
    .trim()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 0);

  if (terms.length === 0) return null;

  return terms.map((term) => `"${term}"*`).join(' AND ');
}
