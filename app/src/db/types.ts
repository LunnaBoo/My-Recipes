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
