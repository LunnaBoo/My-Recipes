export type EditorAction =
  | 'bold'
  | 'italic'
  | 'heading'
  | 'bulleted'
  | 'numbered'
  | 'checkbox'
  | 'divider';

export type Selection = { start: number; end: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Index of the first character of the line containing `index`. */
function lineStart(text: string, index: number): number {
  const previousBreak = text.lastIndexOf('\n', Math.max(0, index - 1));
  return previousBreak === -1 ? 0 : previousBreak + 1;
}

/** Index just past the last character of the line containing `index`. */
function lineEnd(text: string, index: number): number {
  const nextBreak = text.indexOf('\n', index);
  return nextBreak === -1 ? text.length : nextBreak;
}

/** Prefix a line while keeping its indentation. */
function prefixLine(line: string, prefix: string): string {
  const match = /^(\s*)(.*)$/.exec(line);
  if (!match) return prefix + line;
  return `${match[1] ?? ''}${prefix}${match[2] ?? ''}`;
}

/**
 * Applies a Markdown toolbar action to `text` at `selection`.
 *
 * Pure and synchronous: the editor owns the TextInput, this only computes the
 * next text and where the caret should land. Line prefixes keep indentation and
 * never stack a second marker on a line that already has it.
 */
export function applyEditorAction(
  text: string,
  selection: Selection,
  action: EditorAction,
): { text: string; selection: Selection } {
  const source = text.replace(/\r\n?/g, '\n');
  const start = clamp(selection.start, 0, source.length);
  const end = clamp(selection.end, start, source.length);

  if (action === 'bold' || action === 'italic') {
    const marker = action === 'bold' ? '**' : '*';
    const selected = source.slice(start, end);
    const next = `${source.slice(0, start)}${marker}${selected}${marker}${source.slice(end)}`;

    return {
      text: next,
      selection:
        selected.length === 0
          ? { start: start + marker.length, end: start + marker.length }
          : { start: start + marker.length, end: end + marker.length },
    };
  }

  if (action === 'heading') {
    const prefix = '## ';
    const from = lineStart(source, start);
    const current = source.slice(from);

    if (current.startsWith(prefix)) {
      return { text: source, selection: { start, end } };
    }

    return {
      text: `${source.slice(0, from)}${prefix}${source.slice(from)}`,
      selection: { start: start + prefix.length, end: end + prefix.length },
    };
  }

  if (action === 'divider') {
    const before = source.slice(0, start).replace(/\n+$/, '');
    const after = source.slice(end).replace(/^\n+/, '');
    const leading = before.length > 0 ? '\n\n' : '';
    const trailing = after.length > 0 ? '\n\n' : '';
    const insert = `${leading}---${trailing}`;
    const caret = before.length + insert.length;

    return {
      text: `${before}${insert}${after}`,
      selection: { start: caret, end: caret },
    };
  }

  const from = lineStart(source, start);
  const to = lineEnd(source, end === start ? start : end);
  const block = source.slice(from, to);
  const lines = block.split('\n');

  let counter = 1;
  const prefixed = lines
    .map((line) => {
      if (action === 'numbered') {
        const value = `${counter}. `;
        counter += 1;
        return prefixLine(line, value);
      }
      if (action === 'checkbox') return prefixLine(line, '- [ ] ');
      return prefixLine(line, '- ');
    })
    .join('\n');

  return {
    text: `${source.slice(0, from)}${prefixed}${source.slice(to)}`,
    selection: { start: from, end: from + prefixed.length },
  };
}
