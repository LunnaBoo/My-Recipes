import assert from 'node:assert/strict';
import test from 'node:test';

import { TRASH_WINDOW_DAYS, daysUntilExpiry } from '../src/lib/trash';

const DAY_MS = 24 * 60 * 60 * 1000;

test('daysUntilExpiry counts the whole 30-day window on deletion day', () => {
  const now = 1_700_000_000_000;

  assert.equal(daysUntilExpiry(now, now), TRASH_WINDOW_DAYS);
  assert.equal(daysUntilExpiry(now, now + 1), TRASH_WINDOW_DAYS);
});

test('daysUntilExpiry counts down in whole days', () => {
  const now = 1_700_000_000_000;

  assert.equal(daysUntilExpiry(now - DAY_MS, now), TRASH_WINDOW_DAYS - 1);
  assert.equal(daysUntilExpiry(now - 29 * DAY_MS, now), 1);
  assert.equal(daysUntilExpiry(now - 29 * DAY_MS - 1, now), 1);
});

test('daysUntilExpiry clamps at zero', () => {
  const now = 1_700_000_000_000;

  assert.equal(daysUntilExpiry(now - 30 * DAY_MS, now), 0);
  assert.equal(daysUntilExpiry(now - 400 * DAY_MS, now), 0);
  assert.equal(daysUntilExpiry(now + DAY_MS, now), TRASH_WINDOW_DAYS);
});

test('daysUntilExpiry is defensive about invalid input', () => {
  assert.equal(daysUntilExpiry(Number.NaN), 0);
  assert.equal(daysUntilExpiry(1_700_000_000_000, Number.NaN), 0);
});
