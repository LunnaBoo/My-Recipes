import { useFocusEffect, useRouter } from 'expo-router';
import { memo, useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionSheet, type ActionSheetItem } from '../components/ActionSheet';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ScreenFrame } from '../components/ScreenFrame';
import { Snackbar } from '../components/Snackbar';
import { IvyWreath } from '../components/ornaments';
import { listTrashed, purgeRecipe, restoreRecipe } from '../db/repository';
import type { RecipeRow } from '../db/types';
import { ptBR } from '../i18n/pt-BR';
import { daysUntilExpiry } from '../lib/trash';
import { theme } from '../theme';

type SnackbarState = { id: number; message: string };

type TrashRowProps = {
  item: RecipeRow;
  busy: boolean;
  onRestore: (item: RecipeRow) => void;
  onMenu: (item: RecipeRow) => void;
};

/**
 * Trash row: title plus the remaining days. Tapping restores (the common case);
 * the overflow button and a long press open the destructive actions, so the
 * irreversible delete is never a single accidental tap.
 */
const TrashRow = memo(function TrashRow({ item, busy, onRestore, onMenu }: TrashRowProps) {
  const days = daysUntilExpiry(item.deleted_at ?? 0);

  return (
    <View style={[styles.row, busy && styles.rowBusy]}>
      <Pressable
        accessibilityHint={ptBR.trashRestoreHint}
        accessibilityLabel={ptBR.trashItemAccessibility(item.title, days)}
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onLongPress={() => onMenu(item)}
        onPress={() => onRestore(item)}
        style={({ pressed }) => [styles.rowMain, pressed && styles.rowMainPressed]}
      >
        <Text numberOfLines={2} style={styles.rowTitle}>
          {item.title}
        </Text>
        <Text style={styles.rowMeta}>{ptBR.trashExpiresIn(days)}</Text>
      </Pressable>

      <Pressable
        accessibilityLabel={`${ptBR.moreOptions}: ${item.title}`}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={() => onMenu(item)}
        style={({ pressed }) => [styles.rowMenu, pressed && styles.rowMenuPressed]}
      >
        <Text
          accessibilityElementsHidden
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          style={styles.rowMenuLabel}
        >
          ⋯
        </Text>
      </Pressable>

      <View pointerEvents="none" style={styles.rule} />
    </View>
  );
});

function EmptyTrash() {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyCard}>
        <IvyWreath />
        <Text style={styles.emptyTitle}>{ptBR.trashEmpty}</Text>
        <Text style={styles.emptyBody}>{ptBR.trashEmptyBody}</Text>
      </View>
    </View>
  );
}

/** Lixeira: restore or permanently delete, with the 30-day window always visible. */
export default function TrashScreen() {
  const router = useRouter();
  const [items, setItems] = useState<RecipeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [menuItem, setMenuItem] = useState<RecipeRow | null>(null);
  const [confirmItem, setConfirmItem] = useState<RecipeRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<SnackbarState | null>(null);

  const refresh = useCallback(() => {
    setRefreshTick((tick) => tick + 1);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      listTrashed()
        .then((rows) => {
          if (cancelled) return;
          setItems(rows);
        })
        .catch((error: unknown) => {
          console.warn('[trash] load failed:', error);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }, [refreshTick]),
  );

  const handleRestore = useCallback(
    async (item: RecipeRow) => {
      if (busyId) return;

      setBusyId(item.id);
      try {
        const restored = await restoreRecipe(item.id);
        if (!restored) {
          refresh();
          return;
        }
        refresh();
        setSnackbar({ id: Date.now(), message: ptBR.trashRestored });
      } catch (error) {
        console.warn('[trash] restore failed:', error);
        setSnackbar({ id: Date.now(), message: ptBR.restoreFailed });
      } finally {
        setBusyId(null);
      }
    },
    [busyId, refresh],
  );

  const handlePurge = useCallback(
    async (item: RecipeRow) => {
      setConfirmItem(null);
      if (busyId) return;

      setBusyId(item.id);
      try {
        const purged = await purgeRecipe(item.id);
        if (!purged) {
          refresh();
          return;
        }
        refresh();
        setSnackbar({ id: Date.now(), message: ptBR.trashPurged });
      } catch (error) {
        console.warn('[trash] purge failed:', error);
        setSnackbar({ id: Date.now(), message: ptBR.purgeFailed });
      } finally {
        setBusyId(null);
      }
    },
    [busyId, refresh],
  );

  const openMenu = useCallback((item: RecipeRow) => {
    setMenuItem(item);
  }, []);

  const menu = menuItem;
  const menuItems: ActionSheetItem[] = menu
    ? [
        {
          label: ptBR.restore,
          onPress: () => {
            setMenuItem(null);
            void handleRestore(menu);
          },
        },
        {
          label: ptBR.purgeForever,
          tone: 'destructive',
          onPress: () => {
            setMenuItem(null);
            setConfirmItem(menu);
          },
        },
      ]
    : [];

  const renderItem = useCallback(
    ({ item }: { item: RecipeRow }) => (
      <TrashRow busy={busyId === item.id} item={item} onMenu={openMenu} onRestore={handleRestore} />
    ),
    [busyId, handleRestore, openMenu],
  );

  return (
    <ScreenFrame corners="top">
      <View style={styles.header}>
        <View style={styles.backHeader}>
          <Pressable
            accessibilityLabel={ptBR.back}
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, pressed && styles.backPressed]}
          >
            <Text style={styles.backChevron}>‹</Text>
          </Pressable>
          <Text style={styles.headerTitle}>{ptBR.trashTitle}</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.mauveTab} />
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={items}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<EmptyTrash />}
          renderItem={renderItem}
          style={styles.list}
        />
      )}

      {snackbar ? (
        <Snackbar
          key={snackbar.id}
          message={snackbar.message}
          onDismiss={() => setSnackbar(null)}
        />
      ) : null}

      <ActionSheet
        items={menuItems}
        onDismiss={() => setMenuItem(null)}
        title={menu?.title}
        visible={menu !== null}
      />

      <ConfirmDialog
        body={ptBR.purgeConfirmBody}
        cancelLabel={ptBR.cancel}
        confirmLabel={ptBR.purgeForever}
        destructive
        onConfirm={() => {
          if (confirmItem) void handlePurge(confirmItem);
        }}
        onDismiss={() => setConfirmItem(null)}
        title={ptBR.purgeConfirmTitle}
        visible={confirmItem !== null}
      />
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  backHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: theme.colors.cream,
    borderWidth: 1.5,
    borderColor: theme.colors.tan,
  },
  backPressed: {
    opacity: 0.7,
  },
  backChevron: {
    ...theme.typography.recipeTitle,
    color: theme.colors.ink,
    fontSize: 28,
    lineHeight: 30,
    marginTop: -4,
  },
  headerTitle: {
    ...theme.typography.sectionTitle,
    color: theme.colors.ink,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: theme.spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  rowBusy: {
    opacity: 0.5,
  },
  rowMain: {
    flex: 1,
    minHeight: 64,
    justifyContent: 'center',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.md,
    paddingLeft: theme.spacing.lg,
    paddingRight: theme.spacing.sm,
  },
  rowMainPressed: {
    backgroundColor: theme.colors.sageLight,
  },
  rowTitle: {
    ...theme.typography.listTitle,
    color: theme.colors.ink,
  },
  rowMeta: {
    ...theme.typography.meta,
    color: theme.colors.inkLight,
  },
  rowMenu: {
    width: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.md,
  },
  rowMenuPressed: {
    backgroundColor: theme.colors.sageLight,
  },
  rowMenuLabel: {
    ...theme.typography.recipeTitle,
    color: theme.colors.inkLight,
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
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  emptyCard: {
    width: '100%',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.xl,
    backgroundColor: theme.colors.cream,
    borderWidth: 1.5,
    borderColor: theme.colors.tan,
    borderRadius: theme.radii.lg,
  },
  emptyTitle: {
    ...theme.typography.sectionTitle,
    color: theme.colors.ink,
    textAlign: 'center',
  },
  emptyBody: {
    ...theme.typography.bodySmall,
    color: theme.colors.inkLight,
    textAlign: 'center',
    maxWidth: 240,
  },
});
