import assert from 'node:assert/strict';
import test from 'node:test';

import { newId } from '../src/lib/newId';

test('generates RFC 4122 version 4 UUIDs', () => {
  const ids = new Set<string>();

  for (let i = 0; i < 100; i += 1) {
    const id = newId();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    ids.add(id);
  }

  assert.equal(ids.size, 100);
});
