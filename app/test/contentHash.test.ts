import assert from 'node:assert/strict';
import test from 'node:test';

import { contentHash, sha256Hex } from '../src/lib/contentHash';

test('hashes the empty string', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('hashes the standard abc vector', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('hashes a multi-block message', () => {
  assert.equal(
    sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  );
});

test('handles UTF-8 (including an emoji surrogate pair)', () => {
  assert.equal(
    contentHash('Bolo de fubá 🍰'),
    '7beff158a51b9c76fe9415ae980a3f30b9f5c36a47fd2ba5bdaa41a5bf4b739c',
  );
});

test('is stable for the same body and changes when the body changes', () => {
  const body = '1. Misture\n2. Asse';
  assert.equal(contentHash(body), contentHash(body));
  assert.notEqual(contentHash(body), contentHash(`${body}\n`));
});
