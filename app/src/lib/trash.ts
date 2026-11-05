/** Trash window (SPEC.md §4.1): deleted recipes are purged after 30 days. */
export const TRASH_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days left before the purge, clamped at 0.
 *
 * `Math.ceil` keeps "expira em 30 dias" on the day of deletion and turns into
 * "dia 29" only after a full day has passed. Anything already past the window
 * (including a clock skew in the future) clamps to 0 instead of going negative.
 */
export function daysUntilExpiry(
  deletedAt: number,
  now = Date.now(),
  windowDays = TRASH_WINDOW_DAYS,
): number {
  if (!Number.isFinite(deletedAt) || !Number.isFinite(now) || !Number.isFinite(windowDays)) {
    return 0;
  }

  const remaining = deletedAt + windowDays * DAY_MS - now;
  if (remaining <= 0) return 0;

  return Math.min(windowDays, Math.ceil(remaining / DAY_MS));
}
