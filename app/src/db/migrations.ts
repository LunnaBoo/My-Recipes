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
  {
    // Mailbox (MAILBOX.md §7.1). `mailbox` is a singleton; `letters` is a cache
    // of the server list plus the local read state, which never leaves the
    // device. The sender address is not stored, matching the server.
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS mailbox (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        address TEXT NOT NULL,
        secret TEXT NOT NULL,
        registered_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY NOT NULL,
        mailbox_address TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        seal_json TEXT,
        created_at INTEGER NOT NULL,
        last_sent_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS letters (
        letter_id TEXT PRIMARY KEY NOT NULL,
        share_id TEXT NOT NULL,
        title TEXT,
        step_count INTEGER,
        sender_name TEXT,
        sender_seal TEXT,
        sent_at INTEGER NOT NULL,
        read_at INTEGER,
        available INTEGER NOT NULL DEFAULT 1,
        received_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_letters_sent_at ON letters(sent_at DESC);
      CREATE INDEX IF NOT EXISTS idx_letters_read_at ON letters(read_at);
    `,
  },
];
