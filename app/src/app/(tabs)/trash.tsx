import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { FolderTabs } from '../../components/FolderTabs';
import { ScreenFrame } from '../../components/ScreenFrame';
import { SectionHeader } from '../../components/SectionHeader';
import { countTrashed } from '../../db/repository';
import { ptBR } from '../../i18n/pt-BR';
import { theme } from '../../theme';

/**
 * Minimal Lixeira root: it proves the tab route and shell while the real
 * restore/delete-forever actions stay in their own lane.
 */
export default function TrashScreen() {
  const [count, setCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      countTrashed()
        .then((trashed) => {
          if (!cancelled) setCount(trashed);
        })
        .catch((error: unknown) => {
          console.warn('[trash] count failed:', error);
          if (!cancelled) setCount(0);
        });

      return () => {
        cancelled = true;
      };
    }, []),
  );

  return (
    <ScreenFrame corners="top" tabs={<FolderTabs active="trash" trashCount={count} />}>
      <ScrollView contentContainerStyle={styles.content} style={styles.flex}>
        <SectionHeader title={ptBR.trashTitle} />

        <View style={styles.card}>
          <Text style={styles.body}>{count > 0 ? ptBR.trashCount(count) : ptBR.trashEmpty}</Text>
          <Text style={styles.hint}>{ptBR.trashPlaceholder}</Text>
        </View>
      </ScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    padding: theme.spacing.lg,
    gap: theme.spacing.lg,
  },
  card: {
    gap: theme.spacing.sm,
    padding: theme.spacing.xl,
    backgroundColor: theme.colors.cream,
    borderWidth: 1.5,
    borderColor: theme.colors.tan,
    borderRadius: theme.radii.lg,
  },
  body: {
    ...theme.typography.body,
    color: theme.colors.ink,
  },
  hint: {
    ...theme.typography.bodySmall,
    color: theme.colors.inkLight,
  },
});
