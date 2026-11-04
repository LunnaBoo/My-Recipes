import assert from 'node:assert/strict';
import test from 'node:test';

import { examples, pasteImport } from '../src/lib/pasteImport';

test('the feijão example yields the title and 12 steps', () => {
  const result = pasteImport(examples.feijao);
  assert.equal(result.title, 'GUIA: COMO PREPARAR FEIJÃO');
  assert.equal(result.stepCount, 12);
  assert.equal(result.body.split('\n').length, 12);
  assert.ok(result.body.includes('**(MENOS O SAL)**'));
  assert.ok(!result.body.includes('GUIA: COMO PREPARAR FEIJÃO'));
});

test('strips markdown decorations around the title', () => {
  assert.equal(pasteImport('*-- Bolo de fubá --*').title, 'Bolo de fubá');
  assert.equal(pasteImport('# Torta de frango').title, 'Torta de frango');
  assert.equal(pasteImport('_Sopa de legumes_').title, 'Sopa de legumes');
  assert.equal(pasteImport('— Arroz branco —').title, 'Arroz branco');
});

test('removes the title line from the body', () => {
  const result = pasteImport('PANQUECA\n1. Misture tudo\n2. Asse');
  assert.equal(result.title, 'PANQUECA');
  assert.equal(result.body, '1. Misture tudo\n2. Asse');
  assert.equal(result.stepCount, 2);
});

test('skips leading blank lines before the title', () => {
  const result = pasteImport('\n\n   \nTítulo\n\n1. Passo');
  assert.equal(result.title, 'Título');
  assert.equal(result.body, '1. Passo');
});

test('keeps an over-long first line in the body and truncates the title', () => {
  const longLine = 'A'.repeat(130);
  const result = pasteImport(`${longLine}\n1. Passo`);

  assert.equal(result.title.length, 120);
  assert.equal(result.title, 'A'.repeat(120));
  assert.ok(result.body.startsWith(longLine));
  assert.equal(result.stepCount, 1);
});

test('converts WhatsApp bold but leaves existing markdown alone', () => {
  const result = pasteImport('Título\n*forte* e **já forte** e _itálico_');
  assert.equal(result.body, '**forte** e **já forte** e _itálico_');
});

test('converts strikethrough tildes', () => {
  const result = pasteImport('Título\n~riscado~ e ~~já riscado~~');
  assert.equal(result.body, '~~riscado~~ e ~~já riscado~~');
});

test('normalizes CRLF and trailing whitespace, preserving list indentation', () => {
  const result = pasteImport('Título   \r\n\r\n  1. Um   \r\n    - Dois\t\r\n');
  assert.equal(result.body, '  1. Um\n    - Dois');
});

test('leaves quotes, bullets and numbered lists untouched', () => {
  const body = ['> nota', '- item', '1. passo'].join('\n');
  const result = pasteImport(`Título\n${body}`);
  assert.equal(result.body, body);
});

test('empty input produces an empty result', () => {
  assert.deepEqual(pasteImport('   \n\n'), { title: '', body: '', stepCount: 0 });
});
