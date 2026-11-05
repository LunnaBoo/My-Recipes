import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorAction } from '../src/lib/editorActions';

test('bold wraps the selection and keeps it selected', () => {
  const result = applyEditorAction('feijão temperado', { start: 0, end: 6 }, 'bold');

  assert.equal(result.text, '**feijão** temperado');
  assert.deepEqual(result.selection, { start: 2, end: 8 });
});

test('bold with no selection inserts markers and puts the caret between them', () => {
  const result = applyEditorAction('abc', { start: 1, end: 1 }, 'bold');

  assert.equal(result.text, 'a****bc');
  assert.deepEqual(result.selection, { start: 3, end: 3 });
});

test('italic uses a single asterisk', () => {
  const result = applyEditorAction('abc', { start: 0, end: 3 }, 'italic');

  assert.equal(result.text, '*abc*');
  assert.deepEqual(result.selection, { start: 1, end: 4 });
});

test('heading prefixes the line at the caret, not the document', () => {
  const text = 'primeira linha\nsegunda linha';
  const result = applyEditorAction(text, { start: 17, end: 17 }, 'heading');

  assert.equal(result.text, 'primeira linha\n## segunda linha');
  assert.deepEqual(result.selection, { start: 20, end: 20 });
});

test('heading is not applied twice to the same line', () => {
  const text = '## título';
  const result = applyEditorAction(text, { start: 5, end: 5 }, 'heading');

  assert.equal(result.text, text);
  assert.deepEqual(result.selection, { start: 5, end: 5 });
});

test('bulleted prefixes every selected line and preserves indentation', () => {
  const text = 'um\n  dois\ntrês';
  const result = applyEditorAction(text, { start: 0, end: text.length }, 'bulleted');

  assert.equal(result.text, '- um\n  - dois\n- três');
  assert.deepEqual(result.selection, { start: 0, end: result.text.length });
});

test('numbered numbers each selected line from one', () => {
  const text = 'um\ndois\ntrês';
  const result = applyEditorAction(text, { start: 0, end: text.length }, 'numbered');

  assert.equal(result.text, '1. um\n2. dois\n3. três');
});

test('checkbox prefixes with an unchecked task marker', () => {
  const result = applyEditorAction('comprar pão', { start: 0, end: 0 }, 'checkbox');

  assert.equal(result.text, '- [ ] comprar pão');
});

test('bulleted with an empty selection only touches the current line', () => {
  const text = 'um\ndois';
  const result = applyEditorAction(text, { start: 4, end: 4 }, 'bulleted');

  assert.equal(result.text, 'um\n- dois');
});

test('divider on an empty document inserts just the rule', () => {
  const result = applyEditorAction('', { start: 0, end: 0 }, 'divider');

  assert.equal(result.text, '---');
  assert.deepEqual(result.selection, { start: 3, end: 3 });
});

test('divider between blocks never leaves more than one blank line', () => {
  const text = 'um\n\n\ndois';
  const result = applyEditorAction(text, { start: 2, end: 2 }, 'divider');

  assert.equal(result.text, 'um\n\n---\n\ndois');
});

test('divider at the end does not add trailing blank lines', () => {
  const result = applyEditorAction('um', { start: 2, end: 2 }, 'divider');

  assert.equal(result.text, 'um\n\n---');
});

test('CRLF input is normalised', () => {
  const result = applyEditorAction('um\r\ndois', { start: 0, end: 0 }, 'bulleted');

  assert.equal(result.text, '- um\ndois');
});

test('selections outside the text are clamped instead of crashing', () => {
  const result = applyEditorAction('abc', { start: 99, end: 120 }, 'bold');

  assert.equal(result.text, 'abc****');
  assert.deepEqual(result.selection, { start: 5, end: 5 });
});
