import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildShareMessage,
  isValidShareId,
  parseShareUrl,
} from '../src/lib/shareLink';

const ID = 'abcdefghjkmn';
const URL = `https://r.lunna.boo/r/${ID}`;

test('accepts a full share URL', () => {
  assert.equal(parseShareUrl(URL), ID);
});

test('accepts a trailing slash and a query string', () => {
  assert.equal(parseShareUrl(`${URL}/`), ID);
  assert.equal(parseShareUrl(`${URL}?utm=whatsapp`), ID);
  assert.equal(parseShareUrl(`  ${URL}/?from=chat  `), ID);
});

test('accepts a bare 12-char id', () => {
  assert.equal(parseShareUrl(ID), ID);
  assert.equal(parseShareUrl(`  ${ID}  `), ID);
});

test('rejects other hosts, schemes and paths', () => {
  assert.equal(parseShareUrl(`http://r.lunna.boo/r/${ID}`), null);
  assert.equal(parseShareUrl(`https://example.com/r/${ID}`), null);
  assert.equal(parseShareUrl(`https://r.lunna.boo/r/${ID}/extra`), null);
  assert.equal(parseShareUrl(`https://r.lunna.boo/${ID}`), null);
  assert.equal(parseShareUrl('receita qualquer'), null);
  assert.equal(parseShareUrl(''), null);
});

test('rejects malformed ids', () => {
  assert.equal(parseShareUrl('https://r.lunna.boo/r/short'), null);
  assert.equal(parseShareUrl('abcdefghijk0'), null);
  assert.equal(parseShareUrl('ABCDEFGHJKMN'), null);
});

test('validates the share id shape', () => {
  assert.equal(isValidShareId(ID), true);
  assert.equal(isValidShareId('abcdefghjkm'), false);
  assert.equal(isValidShareId('abcdefghjkmnn'), false);
  assert.equal(isValidShareId('abcdefghijk0'), false);
  assert.equal(isValidShareId('ABCDEFGHJKMN'), false);
  assert.equal(isValidShareId(''), false);
});

test('builds the WhatsApp-style share message', () => {
  assert.equal(
    buildShareMessage('Feijão', 12, URL),
    `Feijão · 12 passos\n${URL}`,
  );
  assert.equal(buildShareMessage('Bolo', 1, URL), `Bolo · 1 passo\n${URL}`);
});
