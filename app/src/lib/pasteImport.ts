import { stepCount } from './stepCount';

export type PasteImportResult = {
  title: string;
  body: string;
  stepCount: number;
};

const MAX_TITLE = 120;

/** Strip markdown decorations that surround a pasted title line. */
function cleanTitle(line: string): string {
  let title = line.trim();
  let previous = '';

  while (title !== previous) {
    previous = title;
    title = title
      .replace(/^[*_#\s]+/, '')
      .replace(/[*_#\s]+$/, '')
      .trim();
    title = title.replace(/^--\s*/, '').replace(/\s*--$/, '').trim();
    title = title.replace(/^—\s*/, '').replace(/\s*—$/, '').trim();
  }

  return title;
}

/** Drop leading/trailing blank lines without touching list indentation. */
function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start].trim() === '') start += 1;
  while (end > start && lines[end - 1].trim() === '') end -= 1;

  return lines.slice(start, end);
}

/** WhatsApp emphasis -> CommonMark. `_x_`, lists and quotes are left alone. */
function convertEmphasis(text: string): string {
  return text
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '**$1**')
    .replace(/(?<!~)~([^~\n]+)~(?!~)/g, '~~$1~~');
}

/**
 * Parse a pasted WhatsApp message into `{ title, body, stepCount }`
 * following SPEC §6.4 exactly.
 */
export function pasteImport(input: string): PasteImportResult {
  const normalized = input.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n').map((line) => line.replace(/[ \t]+$/, ''));

  const firstIndex = lines.findIndex((line) => line.trim() !== '');

  let title = '';
  let bodyLines: string[];

  if (firstIndex === -1) {
    bodyLines = [];
  } else {
    const titleLine = lines[firstIndex];
    const cleaned = cleanTitle(titleLine);

    if (cleaned.length > MAX_TITLE) {
      // Too long to be a title: truncate and keep the line in the body.
      title = cleaned.slice(0, MAX_TITLE);
      bodyLines = lines.slice(firstIndex);
    } else {
      title = cleaned;
      bodyLines = lines.slice(firstIndex + 1);
    }
  }

  const body = convertEmphasis(trimBlankLines(bodyLines).join('\n'));

  return { title, body, stepCount: stepCount(body) };
}

/**
 * The feijão example from SPEC §6.4, expanded to its full 12 steps so the
 * step-count assertion is meaningful.
 */
export const examples = {
  feijao: [
    '*-- GUIA: COMO PREPARAR FEIJÃO --*',
    '1. Coloque 1 batata grande em uma panela e cubra com água.',
    '2. Deixe ferver por 10 minutos e escorra a água.',
    '3. Adicione 2 xícaras de feijão carioca lavado.',
    '4. Cubra com água fria e leve ao fogo alto.',
    '5. ... *(MENOS O SAL)* ... tempere com alho, cebola e louro.',
    '6. Abaixe o fogo e cozinhe por 40 minutos.',
    '7. Verifique se o caldo está no ponto desejado.',
    '8. Amasse alguns grãos para engrossar o caldo.',
    '9. Prove e ajuste os temperos.',
    '10. Desligue o fogo e deixe descansar por 10 minutos.',
    '11. Sirva com arroz branco e couve refogada.',
    '12. Seja feliz.',
  ].join('\n'),
} as const;
