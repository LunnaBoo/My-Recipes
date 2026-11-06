export type RecipeRow = {
  id: string;
  title: string;
  file_path: string;
  step_count: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  source_share_id: string | null;
  source_name: string | null;
  source_seal: string | null;
  imported_at: number | null;
  content_hash: string;
  pinned: number;
};

export type Recipe = RecipeRow & {
  body: string;
};

export type RecipeListItem = RecipeRow & {
  excerpt: string;
};

export type RecipeSource = {
  shareId: string;
  name: string | null;
  seal: string | null;
  importedAt?: number;
};

export type CreateRecipeInput = {
  title: string;
  body: string;
  pinned?: boolean;
  source?: RecipeSource;
};

export type UpdateRecipeInput = {
  title?: string;
  body?: string;
  pinned?: boolean;
};

/**
 * A recipe restored from a backup. Unlike `CreateRecipeInput` it keeps the
 * original id and timestamps, and it may be pinned or imported.
 */
export type ImportedRecipeInput = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned: number;
  sourceShareId: string | null;
  sourceName: string | null;
  sourceSeal: string | null;
  importedAt: number | null;
  contentHash: string;
  body: string;
};

export type ListRecipesOptions = {
  query?: string;
  pinnedOnly?: boolean;
  includeDeleted?: boolean;
};

export type Profile = {
  displayName: string;
  sealJson: string | null;
};

export type ShareRecord = {
  share_id: string;
  recipe_id: string;
  published_at: number;
  revoked_at: number | null;
};

/** Local mailbox identity singleton (`mailbox` table, `id = 1`). */
export type Mailbox = {
  address: string;
  secret: string;
  registeredAt: number;
};

export type ContactRow = {
  id: string;
  mailbox_address: string;
  display_name: string;
  seal_json: string | null;
  created_at: number;
  last_sent_at: number | null;
};

/** Cached server letter plus the local read state (`read_at`). */
export type LetterRow = {
  letter_id: string;
  share_id: string;
  title: string | null;
  step_count: number | null;
  sender_name: string | null;
  sender_seal: string | null;
  sent_at: number;
  read_at: number | null;
  available: number;
  received_at: number;
};

export type AddContactInput = {
  address: string;
  displayName: string;
  sealJson?: string | null;
  createdAt?: number;
  lastSentAt?: number | null;
};
