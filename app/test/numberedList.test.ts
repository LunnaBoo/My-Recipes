import assert from 'node:assert/strict';
import test from 'node:test';

import {
  continueOrderedList,
  detectEnterInsertion,
  renumberOrderedList,
  type Selection,
} from '../src/lib/numberedList';

const sel = (start: number, end = start): Selection => ({ start, end });

// ---------------------------------------------------------------------------
// renumberOrderedList
// ---------------------------------------------------------------------------

test('renumbers a simple ordered list starting from one', () => {
  const text = '1. a\n2. b\n3. c';
  const result = renumberOrderedList(text, sel(text.length));

  assert.equal(result.text, text);
  assert.deepEqual(result.selection, sel(text.length));
});

test('renumbers a broken list from its first item', () => {
  const text = '5. a\n7. b\n9. c';
  const result = renumberOrderedList(text, sel(text.length));

  assert.equal(result.text, '5. a\n6. b\n7. c');
  assert.deepEqual(result.selection, sel(result.text.length));
});

test('renumbers each contiguous block independently', () => {
  const text = '1. a\n3. b\n\n10. x\n12. y';
  const result = renumberOrderedList(text, sel(text.length));

  assert.equal(result.text, '1. a\n2. b\n\n10. x\n11. y');
});

test('insert below step 8 shifts old 9 to 10 and old 10 to 11', () => {
  const text = '1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\n8. h\n9. i\n10. j';
  // Cursor at the end of step 8 ("8. h").
  const cursor = text.indexOf('8. h') + '8. h'.length;
  const result = continueOrderedList(text, sel(cursor));

  const expected =
    '1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\n8. h\n9. \n10. i\n11. j';
  assert.equal(result?.text, expected);
  // Caret lands after "9. " on the newly inserted line.
  assert.equal(result?.selection.start, expected.indexOf('9. ') + '9. '.length);
});

test('inserts at the end of the last item and renumbers', () => {
  const text = '1. a\n2. b';
  const cursor = text.length;
  const result = continueOrderedList(text, sel(cursor));

  assert.equal(result?.text, '1. a\n2. b\n3. ');
  assert.equal(result?.selection.start, result!.text.length);
});

test('deleting an empty numbered item removes it and renumbers the rest', () => {
  const text = '1. a\n2. b\n3. \n4. c\n5. d';
  const cursor = text.indexOf('3. ');
  const result = continueOrderedList(text, sel(cursor));

  assert.equal(result?.text, '1. a\n2. b\n3. c\n4. d');
  assert.equal(result?.selection.start, text.indexOf('3. '));
});

test('preserves the delimiter style', () => {
  const text = '1) a\n2) b\n4) c';
  const result = renumberOrderedList(text, sel(text.length));

  assert.equal(result.text, '1) a\n2) b\n3) c');
});

test('preserves indentation for nested lists', () => {
  const text = '1. a\n   3. b\n   4. c\n2. d';
  const result = renumberOrderedList(text, sel(text.length));

  assert.equal(result.text, '1. a\n   1. b\n   2. c\n2. d');
});

test('does not renumber bullets, headings, or paragraphs', () => {
  const text = '- bullet\n## heading\nplain text\n1. a\n2. b';
  const result = renumberOrderedList(text, sel(text.length));

  assert.equal(result.text, text);
});

test('ignores ordered-looking lines inside fenced code blocks', () => {
  const text = '1. a\n```\n2. not a list\n3. also not\n```\n2. b';
  const result = renumberOrderedList(text, sel(text.length));

  assert.equal(result.text, '1. a\n```\n2. not a list\n3. also not\n```\n2. b');
});

test('handles a single-digit to double-digit renumber with selection adjustment', () => {
  const text = '8. a\n9. b\n10. c';
  // Caret at the end of line "9. b" (before the renumber would shift it).
  const lineStart = text.indexOf('9. b');
  const cursor = lineStart + '9. b'.length;
  const result = renumberOrderedList(text, sel(cursor));

  assert.equal(result.text, '8. a\n9. b\n10. c');
  // The third line changed from "10. c" to "10. c": no length change.
  assert.equal(result.selection.start, cursor);
});

test('adjusts selection when 9 becomes 10 before the caret', () => {
  const text = '8. a\n9. b\n10. c';
  const cursor = text.length; // after "10. c"
  const result = renumberOrderedList(text, sel(cursor));

  assert.equal(result.text, '8. a\n9. b\n10. c');
  assert.equal(result.selection.start, cursor);
});

test('starts from 1 when the first number is not positive', () => {
  const text = '0. a\n0. b\n0. c';
  const result = renumberOrderedList(text, sel(text.length));

  assert.equal(result.text, '1. a\n2. b\n3. c');
});

// ---------------------------------------------------------------------------
// continueOrderedList
// ---------------------------------------------------------------------------

test('splits a numbered item in the middle', () => {
  const text = '1. step one';
  const cursor = '1. step '.length;
  const result = continueOrderedList(text, sel(cursor));

  assert.equal(result?.text, '1. step \n2. one');
  assert.equal(result?.selection.start, result!.text.indexOf('2. ') + '2. '.length);
});

test('inserts a new empty item when the cursor is inside the marker', () => {
  const text = '1. a';
  const cursor = 2; // between "1" and "."
  const result = continueOrderedList(text, sel(cursor));

  assert.equal(result?.text, '1. a\n2. ');
});

test('returns null for a non-list line', () => {
  const result = continueOrderedList('plain text', sel(5));
  assert.equal(result, null);
});

test('continuing on the last empty item removes it cleanly', () => {
  const text = '1. a\n2. ';
  const cursor = text.indexOf('2. ');
  const result = continueOrderedList(text, sel(cursor));

  assert.equal(result?.text, '1. a');
  assert.equal(result?.selection.start, '1. a'.length);
});

// ---------------------------------------------------------------------------
// detectEnterInsertion
// ---------------------------------------------------------------------------

test('detects a single newline inserted at the caret', () => {
  const prev = 'hello world';
  const next = 'hello\n world';
  assert.equal(detectEnterInsertion(prev, next, sel(5)), true);
});

test('does not detect Enter when two characters are inserted', () => {
  const prev = 'hello world';
  const next = 'hello! world';
  assert.equal(detectEnterInsertion(prev, next, sel(5)), false);
});

test('does not detect Enter when the newline is elsewhere', () => {
  const prev = 'hello world';
  const next = 'hello world\n';
  assert.equal(detectEnterInsertion(prev, next, sel(5)), false);
});
