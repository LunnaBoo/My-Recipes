import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatSize,
  isNewer,
  parseManifest,
  type UpdateManifest,
} from '../src/lib/updateLogic';

const base: UpdateManifest = {
  versionCode: 2,
  versionName: '1.1.0',
  url: 'https://r.lunna.boo/app/latest.apk',
};

test('isNewer only accepts a strictly greater versionCode', () => {
  assert.equal(isNewer(base, 1), true);
  assert.equal(isNewer(base, 2), false);
  assert.equal(isNewer(base, 3), false);
});

test('isNewer is false when the current code is unknown', () => {
  assert.equal(isNewer(base, Number.NaN), false);
});

test('parseManifest accepts a complete manifest', () => {
  assert.deepEqual(
    parseManifest({
      versionCode: 4,
      versionName: '1.2.0',
      url: 'https://r.lunna.boo/app/latest.apk',
      notes: 'Correções e melhorias.',
      size: 23_000_000,
    }),
    {
      versionCode: 4,
      versionName: '1.2.0',
      url: 'https://r.lunna.boo/app/latest.apk',
      notes: 'Correções e melhorias.',
      size: 23_000_000,
    },
  );
});

test('parseManifest rejects missing required fields', () => {
  assert.equal(parseManifest({ versionName: '1.1.0', url: base.url }), null);
  assert.equal(parseManifest({ versionCode: 2, url: base.url }), null);
  assert.equal(parseManifest({ versionCode: 2, versionName: '1.1.0' }), null);
  assert.equal(parseManifest(null), null);
  assert.equal(parseManifest([]), null);
  assert.equal(parseManifest('not json'), null);
});

test('parseManifest rejects non-https URLs', () => {
  assert.equal(parseManifest({ ...base, url: 'http://r.lunna.boo/app.apk' }), null);
  assert.equal(parseManifest({ ...base, url: '/app/latest.apk' }), null);
  assert.equal(parseManifest({ ...base, url: 'javascript:alert(1)' }), null);
});

test('parseManifest rejects invalid version codes', () => {
  assert.equal(parseManifest({ ...base, versionCode: -1 }), null);
  assert.equal(parseManifest({ ...base, versionCode: 0 }), null);
  assert.equal(parseManifest({ ...base, versionCode: Number.NaN }), null);
  assert.equal(parseManifest({ ...base, versionCode: 1.5 }), null);
  assert.equal(parseManifest({ ...base, versionCode: '2' }), null);
});

test('parseManifest rejects empty optional fields with the wrong type', () => {
  assert.equal(parseManifest({ ...base, notes: '' }), null);
  assert.equal(parseManifest({ ...base, notes: 42 }), null);
  assert.equal(parseManifest({ ...base, size: 0 }), null);
  assert.equal(parseManifest({ ...base, size: Number.NaN }), null);
  assert.equal(parseManifest({ ...base, size: '23000000' }), null);
});

test('formatSize uses B, KB and MB', () => {
  assert.equal(formatSize(0), '0 B');
  assert.equal(formatSize(512), '512 B');
  assert.equal(formatSize(1024), '1 KB');
  assert.equal(formatSize(1536), '1.5 KB');
  assert.equal(formatSize(1024 * 1024), '1 MB');
  assert.equal(formatSize(5.5 * 1024 * 1024), '5.5 MB');
});

test('formatSize handles invalid input defensively', () => {
  assert.equal(formatSize(Number.NaN), '0 B');
  assert.equal(formatSize(-10), '0 B');
});
