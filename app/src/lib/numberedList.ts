/**
 * Ordered-list renumbering for the recipe editor.
 *
 * Pure logic: no React Native imports, so it runs under `node:test` as well as
 * on the device. The editor calls `continueOrderedList` when it detects Enter,
 * then `renumberOrderedList` after every body change so numbering stays
 * consistent while the user types.
 */

export type Selection = { start: number; end: number };

const ORDERED_RE = /^(\s*)(\d+)([.)])(\s+)(.*)$/;
const FENCE_RE = /^```\s*\S*\s*$/;

function lineIndexAt(text: string, index: number): number {
  if (index <= 0) return 0;
  let line = 0;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

function lineStartPos(text: string, lineIndex: number): number {
  const lines = text.split('\n');
  let pos = 0;
  for (let i = 0; i < lineIndex && i < lines.length; i += 1) {
    pos += lines[i].length + 1;
  }
  return pos;
}

function isOrderedLine(line: string): boolean {
  return ORDERED_RE.test(line);
}

function parseOrderedLine(line: string):
  | { indent: string; number: string; delimiter: string; separator: string; text: string }
  | null {
  const match = ORDERED_RE.exec(line);
  if (!match) return null;
  return {
    indent: match[1],
    number: match[2],
    delimiter: match[3],
    separator: match[4],
    text: match[5],
  };
}

type RenumberGroup = {
  startNumber: number;
  lineIndices: number[];
};

/**
 * Adjusts a selection to account for digit-length changes caused by renumbering.
 *
 * The caret is assumed to be after the number marker of its line; if the number
 * before the caret changes length, the selection is shifted by the delta. Carets
 * before the number marker are left untouched.
 */
function adjustSelection(
  oldLines: readonly string[],
  newLines: readonly string[],
  selection: Selection,
): Selection {
  let start = selection.start;
  let end = selection.end;
  let pos = 0;

  for (let i = 0; i < oldLines.length; i += 1) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    const delta = newLine.length - oldLine.length;

    if (delta !== 0) {
      const parsed = parseOrderedLine(oldLine);
      if (parsed) {
        const markerEnd =
          pos + parsed.indent.length + parsed.number.length + parsed.delimiter.length + parsed.separator.length;
        if (start >= markerEnd) start += delta;
        if (end >= markerEnd) end += delta;
      }
    }

    pos += oldLine.length + 1;
  }

  return { start: Math.max(0, start), end: Math.max(0, end) };
}

/**
 * Renumbers every ordered list in `text`.
 *
 * Rules:
 * - Lines matching `^\s*\d+[.)]\s+` are renumbered.
 * - Contiguous blocks of ordered lines (no blank lines/non-matching lines)
 *   are renumbered together.
 * - Each indentation level inside a block renumbers independently, starting
 *   from the first number of that level (or 1 if it is not positive).
 * - Lines inside fenced code blocks (```) are ignored.
 * - Bullets, headings, and paragraphs are left untouched.
 */
export function renumberOrderedList(
  text: string,
  selection: Selection,
): { text: string; selection: Selection } {
  const oldLines = text.split('\n');
  const newLines = oldLines.slice();
  let inFence = false;

  let i = 0;
  while (i < oldLines.length) {
    const line = oldLines[i];

    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      i += 1;
      continue;
    }

    if (inFence || !isOrderedLine(line)) {
      i += 1;
      continue;
    }

    // Start of a contiguous ordered-list block.
    const blockStart = i;
    let blockEnd = i;
    while (blockEnd < oldLines.length) {
      const l = oldLines[blockEnd];
      if (FENCE_RE.test(l)) {
        inFence = !inFence;
        blockEnd += 1;
        continue;
      }
      if (inFence || l === '' || !isOrderedLine(l)) break;
      blockEnd += 1;
    }

    // Group by indentation; each group renumbers independently.
    const groups = new Map<string, RenumberGroup>();
    for (let j = blockStart; j < blockEnd; j += 1) {
      const parsed = parseOrderedLine(oldLines[j]);
      if (!parsed) continue;

      const existing = groups.get(parsed.indent);
      if (existing) {
        existing.lineIndices.push(j);
      } else {
        // Top-level lists preserve the user-chosen start number; nested lists
        // reset to 1 so each indentation level is an independent sequence.
        const n = parseInt(parsed.number, 10);
        const startNumber = parsed.indent === '' ? (n > 0 ? n : 1) : 1;
        groups.set(parsed.indent, {
          startNumber,
          lineIndices: [j],
        });
      }
    }

    for (const group of groups.values()) {
      for (let k = 0; k < group.lineIndices.length; k += 1) {
        const idx = group.lineIndices[k];
        const parsed = parseOrderedLine(oldLines[idx]);
        if (!parsed) continue;
        const newNumber = String(group.startNumber + k);
        newLines[idx] =
          parsed.indent + newNumber + parsed.delimiter + parsed.separator + parsed.text;
      }
    }

    i = blockEnd;
  }

  const newSelection = adjustSelection(oldLines, newLines, selection);
  return { text: newLines.join('\n'), selection: newSelection };
}

/**
 * Handles Enter inside an ordered list.
 *
 * - At the end or middle of a non-empty item: inserts a new item with the next
 *   number and shifts the following items.
 * - On an empty item: removes the item and renumbers the rest.
 *
 * Returns `null` when the caret is not on an ordered-list line.
 */
export function continueOrderedList(
  text: string,
  selection: Selection,
): { text: string; selection: Selection } | null {
  const lines = text.split('\n');
  const lineIdx = lineIndexAt(text, selection.start);
  if (lineIdx < 0 || lineIdx >= lines.length) return null;

  const line = lines[lineIdx];
  const parsed = parseOrderedLine(line);
  if (!parsed) return null;

  const lineStart = lineStartPos(text, lineIdx);
  const cursorInLine = selection.start - lineStart;
  const prefixLen =
    parsed.indent.length +
    parsed.number.length +
    parsed.delimiter.length +
    parsed.separator.length;

  let insertedLineIdx = lineIdx + 1;
  let insertedPrefixLen = 0;

  if (parsed.text.trim() === '') {
    // Empty item: remove it and let renumber collapse the list.
    lines.splice(lineIdx, 1);
    insertedLineIdx = -1;
  } else if (cursorInLine <= prefixLen) {
    // Cursor inside the marker: insert a new empty item below.
    const nextNumber = String(parseInt(parsed.number, 10) + 1);
    const nextLine =
      parsed.indent + nextNumber + parsed.delimiter + parsed.separator;
    lines.splice(insertedLineIdx, 0, nextLine);
    insertedPrefixLen = nextLine.length;
  } else {
    // Split the current item at the cursor.
    const before = line.slice(prefixLen, cursorInLine);
    const after = line.slice(cursorInLine);
    lines[lineIdx] =
      parsed.indent + parsed.number + parsed.delimiter + parsed.separator + before;
    const nextNumber = String(parseInt(parsed.number, 10) + 1);
    const nextPrefix =
      parsed.indent + nextNumber + parsed.delimiter + parsed.separator;
    const nextLine = nextPrefix + after;
    lines.splice(insertedLineIdx, 0, nextLine);
    insertedPrefixLen = nextPrefix.length;
  }

  const newText = lines.join('\n');

  let newSelection: Selection;
  if (insertedLineIdx === -1) {
    // Removed empty item: leave the caret where the item was, clamped to the
    // shortened text in case the empty item was at the end.
    const caret = Math.min(lineStart, newText.length);
    newSelection = { start: caret, end: caret };
  } else {
    const insertedLineStart = lineStart + lines[lineIdx].length + 1;
    const caret = insertedLineStart + insertedPrefixLen;
    newSelection = { start: caret, end: caret };
  }

  // Renumber the affected list and let it adjust the caret for digit changes.
  return renumberOrderedList(newText, newSelection);
}

/**
 * Returns true when the change from `prevText` to `newText` is exactly the
 * insertion of a single newline at `prevSelection.start`.
 */
export function detectEnterInsertion(
  prevText: string,
  newText: string,
  prevSelection: Selection,
): boolean {
  if (newText.length !== prevText.length + 1) return false;
  const index = prevSelection.start;
  if (newText[index] !== '\n') return false;
  const before = newText.slice(0, index);
  const after = newText.slice(index + 1);
  return before === prevText.slice(0, index) && after === prevText.slice(index);
}
