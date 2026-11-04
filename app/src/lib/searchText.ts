/** Accent- and case-insensitive normalization for the LIKE fallback. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Escape `%`, `_` and `\` so user input is treated as literal text by LIKE. */
export function likePattern(value: string): string {
  const escaped = normalizeSearchText(value).replace(/[\\%_]/g, '\\$&');
  return `%${escaped}%`;
}
