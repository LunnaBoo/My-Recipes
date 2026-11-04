import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { RecipeListItem } from '../db/types';
import { ptBR } from '../i18n/pt-BR';
import { theme } from '../theme';
import { Sparkle } from './ornaments';

type ListRowProps = {
  item: RecipeListItem;
  onPress: (id: string) => void;
  onLongPress: (item: RecipeListItem) => void;
};

/**
 * Text-first recipe row: title, excerpt, right-aligned step count and a gold
 * sparkle for pinned recipes. Rows never carry per-recipe icons.
 */
export const ListRow = memo(function ListRow({ item, onPress, onLongPress }: ListRowProps) {
  const pinned = item.pinned === 1;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={ptBR.listItemAccessibility(item.title, item.step_count, pinned)}
      accessibilityHint={ptBR.listItemHint}
      onPress={() => onPress(item.id)}
      onLongPress={() => onLongPress(item)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {({ pressed }) => (
        <>
          <View style={styles.titleRow}>
            <Text numberOfLines={2} style={styles.title}>
              {item.title}
            </Text>
            {pinned ? (
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                pointerEvents="none"
                style={styles.sparkle}
              >
                <Sparkle />
              </View>
            ) : null}
          </View>

          {item.excerpt ? (
            <Text numberOfLines={3} style={[styles.excerpt, pressed && styles.textPressed]}>
              {item.excerpt}
            </Text>
          ) : null}

          <Text style={[styles.meta, pressed && styles.textPressed]}>
            {ptBR.stepsLabel(item.step_count)}
          </Text>

          <View pointerEvents="none" style={styles.rule} />
        </>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    minHeight: 80,
    justifyContent: 'center',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
  },
  rowPressed: {
    backgroundColor: theme.colors.sageLight,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    paddingRight: theme.spacing.lg,
  },
  title: {
    ...theme.typography.listTitle,
    color: theme.colors.ink,
    flex: 1,
  },
  sparkle: {
    position: 'absolute',
    top: 0,
    right: 0,
  },
  excerpt: {
    ...theme.typography.bodySmall,
    color: theme.colors.inkLight,
  },
  meta: {
    ...theme.typography.meta,
    color: theme.colors.inkLight,
    textAlign: 'right',
  },
  textPressed: {
    color: theme.colors.ink,
  },
  rule: {
    position: 'absolute',
    left: theme.spacing.lg,
    right: theme.spacing.lg,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    opacity: 0.25,
    backgroundColor: theme.colors.inkLight,
  },
});
