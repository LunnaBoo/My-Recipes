import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_SEAL_BYTES,
  SIGIL_IDS,
  base64ByteLength,
  parseSeal,
  sealFromStored,
  sealToPayload,
  sealToStored,
  type Seal,
} from '../src/lib/seal';

function base64(bytes: Uint8Array | number[]): string {
  return Buffer.from(bytes).toString('base64');
}

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d];

test('accepts every allowed sigil id', () => {
  for (const id of SIGIL_IDS) {
    assert.deepEqual(parseSeal({ kind: 'sigil', id }), { kind: 'sigil', id });
  }
});

test('accepts a JPEG image seal and keeps canonical base64', () => {
  const data = base64(JPEG);
  const seal = parseSeal({ kind: 'image', mime: 'image/jpeg', data });

  assert.deepEqual(seal, { kind: 'image', mime: 'image/jpeg', data });
});

test('accepts a PNG image seal when the magic bytes match', () => {
  const data = base64(PNG);
  assert.deepEqual(parseSeal({ kind: 'image', mime: 'image/png', data }), {
    kind: 'image',
    mime: 'image/png',
    data,
  });
});

test('rejects an unknown sigil id', () => {
  assert.equal(parseSeal({ kind: 'sigil', id: 'dragon' }), null);
  assert.equal(parseSeal({ kind: 'sigil', id: 42 }), null);
  assert.equal(parseSeal({ kind: 'sigil' }), null);
});

test('rejects a mime other than JPEG or PNG', () => {
  const data = base64(JPEG);
  assert.equal(parseSeal({ kind: 'image', mime: 'image/webp', data }), null);
  assert.equal(parseSeal({ kind: 'image', mime: 'image/gif', data }), null);
  assert.equal(parseSeal({ kind: 'image', mime: 'image/svg+xml', data }), null);
});

test('rejects data that is not standard base64', () => {
  assert.equal(parseSeal({ kind: 'image', mime: 'image/jpeg', data: 'not base64!' }), null);
  assert.equal(parseSeal({ kind: 'image', mime: 'image/jpeg', data: 'AAAAA' }), null);
  assert.equal(parseSeal({ kind: 'image', mime: 'image/jpeg', data: 'A=AA' }), null);
  assert.equal(parseSeal({ kind: 'image', mime: 'image/jpeg', data: '' }), null);
});

test('rejects an image whose decoded bytes exceed 32 KB', () => {
  const oversized = new Uint8Array(MAX_SEAL_BYTES + 1);
  oversized.set(JPEG);
  const data = base64(oversized);

  // Exactly at the canonical base64 length cap, so the decoded check catches it.
  assert.equal(data.length, 43692);
  assert.equal(parseSeal({ kind: 'image', mime: 'image/jpeg', data }), null);
});

test('rejects an image whose base64 text alone is oversized', () => {
  const data = 'A'.repeat(43696);
  assert.equal(parseSeal({ kind: 'image', mime: 'image/jpeg', data }), null);
});

test('rejects a mime that does not match the magic bytes', () => {
  assert.equal(parseSeal({ kind: 'image', mime: 'image/png', data: base64(JPEG) }), null);
  assert.equal(parseSeal({ kind: 'image', mime: 'image/jpeg', data: base64(PNG) }), null);
});

test('rejects null, legacy and non-object values', () => {
  assert.equal(parseSeal(null), null);
  assert.equal(parseSeal(undefined), null);
  assert.equal(parseSeal('cat'), null);
  assert.equal(parseSeal([]), null);
  assert.equal(parseSeal({}), null);
});

test('sealFromStored survives null, legacy JSON and garbage', () => {
  assert.equal(sealFromStored(null), null);
  assert.equal(sealFromStored(''), null);
  assert.equal(sealFromStored('null'), null);
  assert.equal(sealFromStored('not json'), null);
  assert.equal(sealFromStored('{"kind":"sigil","id":"dragon"}'), null);
  assert.deepEqual(sealFromStored('{"kind":"sigil","id":"owl"}'), {
    kind: 'sigil',
    id: 'owl',
  });
});

test('sealToPayload emits exactly the wire shape', () => {
  const sigil: Seal = { kind: 'sigil', id: 'mushroom' };
  assert.deepEqual(Object.keys(sealToPayload(sigil)).sort(), ['id', 'kind']);

  const data = base64(JPEG);
  const image: Seal = { kind: 'image', mime: 'image/jpeg', data };
  const payload = sealToPayload(image) as Record<string, unknown>;
  assert.deepEqual(Object.keys(payload).sort(), ['data', 'kind', 'mime']);
  assert.equal(payload.kind, 'image');
  assert.equal(payload.mime, 'image/jpeg');
});

test('stored JSON round-trips both seal kinds', () => {
  const sigil: Seal = { kind: 'sigil', id: 'cat' };
  assert.deepEqual(sealFromStored(sealToStored(sigil)), sigil);

  const image: Seal = { kind: 'image', mime: 'image/jpeg', data: base64(JPEG) };
  assert.deepEqual(sealFromStored(sealToStored(image)), image);
});

test('base64ByteLength reports decoded size or null', () => {
  assert.equal(base64ByteLength(base64(JPEG)), JPEG.length);
  assert.equal(base64ByteLength('not base64!'), null);
  assert.equal(base64ByteLength(''), null);
});
