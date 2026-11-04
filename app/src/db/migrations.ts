export type Migration = {
  version: number;
  sql: string;
};

/**
 * Migrations are applied in order and tracked with `PRAGMA user_version`.
 * Each statement is idempotent so a partially interrupted run is safe.
 */
export const migrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS recipes (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        file_path TEXT NOT NULL,
        step_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        source_share_id TEXT,
        source_name TEXT,
        source_seal TEXT,
        imported_at INTEGER,
        content_hash TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_recipes_deleted_at ON recipes(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_recipes_updated_at ON recipes(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_recipes_pinned ON recipes(pinned);

      CREATE TABLE IF NOT EXISTS shares (
        share_id TEXT PRIMARY KEY NOT NULL,
        recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        published_at INTEGER NOT NULL,
        revoked_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_shares_recipe_id ON shares(recipe_id);

      CREATE TABLE IF NOT EXISTS profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        display_name TEXT NOT NULL DEFAULT '',
        seal_json TEXT
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
    `,
  },
];
