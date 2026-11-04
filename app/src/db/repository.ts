import { contentHash, utf8ByteLength } from '../lib/contentHash';
import { firstLine } from '../lib/firstLine';
import { newId } from '../lib/newId';
import { likePattern } from '../lib/searchText';
import { stepCount } from '../lib/stepCount';
import { bodyFilePath, deleteBody, ensureRecipeDir, readBody, writeBody } from '../storage/bodies';
import { getDb, getSearchMode, indexRecipeBody, toFtsQuery } from './client';
import type {
  CreateRecipeInput,
  ListRecipesOptions,
  Profile,
  Recipe,
  RecipeListItem,
  RecipeRow,
  ShareRecord,
  UpdateRecipeInput,
} from './types';

const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 64 * 1024;

function normalizeTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new Error('O título não pode ficar vazio.');
  }
  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new Error(`O título deve ter no máximo ${MAX_TITLE_LENGTH} caracteres.`);
  }
  return trimmed;
}

function assertBody(body: string): void {
  if (utf8ByteLength(body) > MAX_BODY_LENGTH) {
    throw new Error('O corpo da receita deve ter no máximo 64 KB.');
  }
}

async function hydrate(row: RecipeRow): Promise<Recipe> {
  const body = await readBody(row.id);
  return { ...row, body };
}

async function toListItem(row: RecipeRow): Promise<RecipeListItem> {
  const body = await readBody(row.id);
  return { ...row, excerpt: firstLine(body) };
}

export async function createRecipe(input: CreateRecipeInput): Promise<Recipe> {
  const db = await getDb();
  const title = normalizeTitle(input.title);
  const body = input.body;
  assertBody(body);

  const id = newId();
  const now = Date.now();
  const filePath = bodyFilePath(id);
  const hash = contentHash(body);
  const steps = stepCount(body);
  const pinned = input.pinned ? 1 : 0;
  const source = input.source;
  const importedAt = source ? (source.importedAt ?? now) : null;

  await ensureRecipeDir();
  await writeBody(id, body);

  try {
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `INSERT INTO recipes (
          id, title, file_path, step_count, created_at, updated_at, deleted_at,
          source_share_id, source_name, source_seal, imported_at, content_hash, pinned
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          title,
          filePath,
          steps,
          now,
          now,
          source?.shareId ?? null,
          source?.name ?? null,
          source?.seal ?? null,
          importedAt,
          hash,
          pinned,
        ],
      );

      await indexRecipeBody(db, id, title, body);
    });
  } catch (error) {
    await deleteBody(id);
    throw error;
  }

  const created = await getRecipe(id);
  if (!created) throw new Error('Não foi possível criar a receita.');
  return created;
}

export async function updateRecipe(id: string, patch: UpdateRecipeInput): Promise<Recipe> {
  const db = await getDb();
  const existing = await getRecipe(id);
  if (!existing) throw new Error('Receita não encontrada.');

  const title = patch.title !== undefined ? normalizeTitle(patch.title) : existing.title;
  const body = patch.body !== undefined ? patch.body : existing.body;
  assertBody(body);
  const pinned = patch.pinned !== undefined ? (patch.pinned ? 1 : 0) : existing.pinned;
  const bodyChanged = patch.body !== undefined && body !== existing.body;
  const now = Date.now();

  if (bodyChanged) {
    await writeBody(id, body);
  }

  try {
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `UPDATE recipes
         SET title = ?, step_count = ?, updated_at = ?, content_hash = ?, pinned = ?
         WHERE id = ?`,
        [title, stepCount(body), now, contentHash(body), pinned, id],
      );
      await indexRecipeBody(db, id, title, body);
    });
  } catch (error) {
    if (bodyChanged) {
      await writeBody(id, existing.body);
    }
    throw error;
  }

  const updated = await getRecipe(id);
  if (!updated) throw new Error('Receita não encontrada.');
  return updated;
}

export async function getRecipe(id: string): Promise<Recipe | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<RecipeRow>('SELECT * FROM recipes WHERE id = ?', id);
  if (!row) return null;
  return hydrate(row);
}

export async function listRecipes(options: ListRecipesOptions = {}): Promise<RecipeListItem[]> {
  const db = await getDb();
  const { query = '', pinnedOnly = false, includeDeleted = false } = options;
  const trimmedQuery = query.trim();

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (!includeDeleted) conditions.push('r.deleted_at IS NULL');
  if (pinnedOnly) conditions.push('r.pinned = 1');

  let rows: RecipeRow[];

  const ftsQuery = trimmedQuery.length > 0 ? toFtsQuery(trimmedQuery) : null;

  if (ftsQuery && getSearchMode() === 'fts5') {
    const where = [...conditions, 'recipes_fts MATCH ?'].join(' AND ');
    rows = await db.getAllAsync<RecipeRow>(
      `SELECT r.*
       FROM recipes r
       JOIN recipes_fts ON recipes_fts.recipe_id = r.id
       WHERE ${where}
       ORDER BY r.pinned DESC, r.updated_at DESC`,
      [...params, ftsQuery],
    );
  } else if (trimmedQuery.length > 0 && getSearchMode() === 'like') {
    const terms = trimmedQuery.split(/\s+/).filter((term) => term.length > 0);
    const where = [
      ...conditions,
      ...terms.map(() => `f.search_text LIKE ? ESCAPE '\\'`),
    ].join(' AND ');

    rows = await db.getAllAsync<RecipeRow>(
      `SELECT r.*
       FROM recipes r
       JOIN recipes_search_fallback f ON f.recipe_id = r.id
       WHERE ${where}
       ORDER BY r.pinned DESC, r.updated_at DESC`,
      [...params, ...terms.map(likePattern)],
    );
  } else {
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    rows = await db.getAllAsync<RecipeRow>(
      `SELECT r.* FROM recipes r ${where} ORDER BY r.pinned DESC, r.updated_at DESC`,
      params,
    );
  }

  return Promise.all(rows.map(toListItem));
}

export async function softDelete(id: string): Promise<boolean> {
  const db = await getDb();
  const now = Date.now();
  const result = await db.runAsync(
    'UPDATE recipes SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
    [now, now, id],
  );
  return result.changes > 0;
}

/** Number of recipes currently in the trash, used by the Lixeira tab badge. */
export async function countTrashed(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM recipes WHERE deleted_at IS NOT NULL',
  );
  return row?.count ?? 0;
}

export async function restoreRecipe(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.runAsync(
    'UPDATE recipes SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL',
    [Date.now(), id],
  );
  return result.changes > 0;
}

export async function togglePin(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.runAsync(
    'UPDATE recipes SET pinned = CASE pinned WHEN 1 THEN 0 ELSE 1 END WHERE id = ?',
    id,
  );
  return result.changes > 0;
}

export async function purgeExpired(days = 30): Promise<number> {
  const db = await getDb();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const expired = await db.getAllAsync<RecipeRow>(
    'SELECT * FROM recipes WHERE deleted_at IS NOT NULL AND deleted_at <= ?',
    cutoff,
  );

  for (const row of expired) {
    await deleteBody(row.id);
  }

  const result = await db.runAsync(
    'DELETE FROM recipes WHERE deleted_at IS NOT NULL AND deleted_at <= ?',
    cutoff,
  );

  return result.changes;
}

/** Most recent share that has not been revoked, if any. */
export async function getActiveShare(recipeId: string): Promise<ShareRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<ShareRecord>(
    `SELECT * FROM shares
     WHERE recipe_id = ? AND revoked_at IS NULL
     ORDER BY published_at DESC
     LIMIT 1`,
    recipeId,
  );
  return row ?? null;
}

/** Finds the live local copy imported from a share, for dedupe/update. */
export async function getRecipeBySourceShareId(shareId: string): Promise<Recipe | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<RecipeRow>(
    `SELECT * FROM recipes
     WHERE source_share_id = ? AND deleted_at IS NULL
     ORDER BY imported_at DESC
     LIMIT 1`,
    shareId,
  );
  return row ? hydrate(row) : null;
}

/** Finds the local recipe that published this share (same-device dedupe). */
export async function getRecipeByActiveShareId(
  shareId: string,
): Promise<Recipe | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<RecipeRow>(
    `SELECT r.* FROM shares s
     JOIN recipes r ON r.id = s.recipe_id
     WHERE s.share_id = ? AND s.revoked_at IS NULL AND r.deleted_at IS NULL
     LIMIT 1`,
    shareId,
  );
  return row ? hydrate(row) : null;
}

export async function recordShare(
  recipeId: string,
  shareId: string,
  publishedAt = Date.now(),
): Promise<ShareRecord> {
  const db = await getDb();

  await db.runAsync(
    `INSERT INTO shares (share_id, recipe_id, published_at, revoked_at)
     VALUES (?, ?, ?, NULL)
     ON CONFLICT(share_id) DO UPDATE SET
       recipe_id = excluded.recipe_id,
       published_at = excluded.published_at,
       revoked_at = NULL`,
    [shareId, recipeId, publishedAt],
  );

  const row = await db.getFirstAsync<ShareRecord>(
    'SELECT * FROM shares WHERE share_id = ?',
    shareId,
  );
  if (!row) throw new Error('Não foi possível registrar o compartilhamento.');
  return row;
}

/** Small key/value store for app-level bookkeeping (e.g. last update check). */
export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_meta WHERE key = ?',
    key,
  );
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO app_meta (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

export async function getProfile(): Promise<Profile> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ display_name: string; seal_json: string | null }>(
    'SELECT display_name, seal_json FROM profile WHERE id = 1',
  );

  if (!row) return { displayName: '', sealJson: null };
  return { displayName: row.display_name, sealJson: row.seal_json };
}

export async function saveProfile(profile: Profile): Promise<Profile> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO profile (id, display_name, seal_json)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       display_name = excluded.display_name,
       seal_json = excluded.seal_json`,
    [profile.displayName.trim(), profile.sealJson],
  );

  return getProfile();
}
