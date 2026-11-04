import type { ReactNode } from 'react';
import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';

type MarkdownProps = {
  markdown: string;
};

type OrderedItem = { number: string; text: string };

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'ordered'; items: OrderedItem[] }
  | { type: 'unordered'; items: string[] }
  | { type: 'quote'; lines: string[] }
  | { type: 'rule' };

const NUMBERED_RE = /^\s*(\d+)[.)]\s+(.*)$/;
const BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const RULE_RE = /^([-*_])\1{2,}$/;
const QUOTE_RE = /^>\s?(.*)$/;
const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g;

function startsBlock(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length === 0 ||
    HEADING_RE.test(trimmed) ||
    RULE_RE.test(trimmed) ||
    QUOTE_RE.test(trimmed) ||
    NUMBERED_RE.test(line) ||
    BULLET_RE.test(line)
  );
}

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      index += 1;
      continue;
    }

    const heading = HEADING_RE.exec(trimmed);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }

    if (RULE_RE.test(trimmed)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    if (QUOTE_RE.test(trimmed)) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const quoted = QUOTE_RE.exec(lines[index].trim());
        if (!quoted) break;
        quoteLines.push(quoted[1]);
        index += 1;
      }
      blocks.push({ type: 'quote', lines: quoteLines });
      continue;
    }

    const ordered = NUMBERED_RE.exec(line);
    if (ordered) {
      const items: OrderedItem[] = [];
      while (index < lines.length) {
        const match = NUMBERED_RE.exec(lines[index]);
        if (!match) break;
        items.push({ number: match[1], text: match[2] });
        index += 1;
      }
      blocks.push({ type: 'ordered', items });
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = BULLET_RE.exec(lines[index]);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push({ type: 'unordered', items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && !startsBlock(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
  }

  return blocks;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text
    .split(INLINE_RE)
    .filter((part) => part.length > 0)
    .map((part, index) => {
      const key = `${keyPrefix}-${index}`;

      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return (
          <Text key={key} style={styles.bold}>
            {part.slice(2, -2)}
          </Text>
        );
      }

      if (
        ((part.startsWith('*') && part.endsWith('*')) ||
          (part.startsWith('_') && part.endsWith('_'))) &&
        part.length > 2
      ) {
        return (
          <Text key={key} style={styles.italic}>
            {part.slice(1, -1)}
          </Text>
        );
      }

      return <Fragment key={key}>{part}</Fragment>;
    });
}

/**
 * Minimal renderer for the Markdown subset stored by the app: headings,
 * paragraphs, ordered/unordered lists, bold/italic, blockquotes and rules.
 * Ordered items render as scannable step rows with gold numbers.
 */
export function Markdown({ markdown }: MarkdownProps) {
  const blocks = parseBlocks(markdown);

  return (
    <View style={styles.root}>
      {blocks.map((block, blockIndex) => {
        const key = `block-${blockIndex}`;

        switch (block.type) {
          case 'heading':
            return (
              <Text
                key={key}
                style={[styles.heading, block.level <= 2 ? styles.headingLarge : styles.headingSmall]}
              >
                {renderInline(block.text, key)}
              </Text>
            );

          case 'rule':
            return <View key={key} style={styles.rule} />;

          case 'quote':
            return (
              <View key={key} style={styles.quote}>
                <Text style={styles.quoteText}>
                  {block.lines.map((line, lineIndex) => (
                    <Fragment key={`${key}-line-${lineIndex}`}>
                      {lineIndex > 0 ? '\n' : null}
                      {renderInline(line, `${key}-line-${lineIndex}`)}
                    </Fragment>
                  ))}
                </Text>
              </View>
            );

          case 'ordered':
            return (
              <View key={key} style={styles.list}>
                {block.items.map((item, itemIndex) => (
                  <View key={`${key}-item-${itemIndex}`} style={styles.stepRow}>
                    <Text style={styles.stepNumber}>{item.number}.</Text>
                    <Text style={styles.stepText}>
                      {renderInline(item.text, `${key}-item-${itemIndex}`)}
                    </Text>
                  </View>
                ))}
              </View>
            );

          case 'unordered':
            return (
              <View key={key} style={styles.list}>
                {block.items.map((item, itemIndex) => (
                  <View key={`${key}-item-${itemIndex}`} style={styles.stepRow}>
                    <Text style={styles.bullet}>•</Text>
                    <Text style={styles.stepText}>
                      {renderInline(item, `${key}-item-${itemIndex}`)}
                    </Text>
                  </View>
                ))}
              </View>
            );

          case 'paragraph':
          default:
            return (
              <Text key={key} style={styles.paragraph}>
                {renderInline(block.text, key)}
              </Text>
            );
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: theme.spacing.md,
  },
  paragraph: {
    ...theme.typography.body,
    color: theme.colors.ink,
  },
  heading: {
    color: theme.colors.ink,
  },
  headingLarge: {
    ...theme.typography.recipeTitle,
  },
  headingSmall: {
    ...theme.typography.body,
    fontWeight: '700',
  },
  bold: {
    fontWeight: '700',
  },
  italic: {
    fontStyle: 'italic',
  },
  list: {
    gap: theme.spacing.lg,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
  },
  stepNumber: {
    ...theme.typography.body,
    width: 28,
    textAlign: 'right',
    color: theme.colors.gold,
  },
  bullet: {
    ...theme.typography.body,
    width: 28,
    textAlign: 'right',
    color: theme.colors.sage,
  },
  stepText: {
    ...theme.typography.body,
    flex: 1,
    color: theme.colors.ink,
  },
  quote: {
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.sage,
    paddingLeft: theme.spacing.md,
  },
  quoteText: {
    ...theme.typography.body,
    color: theme.colors.inkLight,
    fontStyle: 'italic',
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    opacity: 0.25,
    backgroundColor: theme.colors.inkLight,
  },
});
