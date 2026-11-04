import assert from 'node:assert/strict';
import test from 'node:test';

import { stepCount } from '../src/lib/stepCount';

test('counts numbered steps', () => {
  const body = ['1. Um', '2. Dois', '3) Três'].join('\n');
  assert.equal(stepCount(body), 3);
});

test('counts bullets when there are no numbered steps', () => {
  const body = ['- Um', '* Dois', '  - Três'].join('\n');
  assert.equal(stepCount(body), 3);
});

test('numbered steps win over bullets in a mixed body', () => {
  const body = ['- comprar', '1. Um', '- dois', '2. Dois'].join('\n');
  assert.equal(stepCount(body), 2);
});

test('returns zero for empty or prose-only bodies', () => {
  assert.equal(stepCount(''), 0);
  assert.equal(stepCount('Bolo de fubá\nsem passos numerados'), 0);
});

test('ignores bold text and headings at line start', () => {
  const body = ['**Importante**', '# Título', '1. Passo'].join('\n');
  assert.equal(stepCount(body), 1);
});

test('handles CRLF input', () => {
  assert.equal(stepCount('1. Um\r\n2. Dois\r\n'), 2);
});
