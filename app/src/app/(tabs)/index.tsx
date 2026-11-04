import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet, type ActionSheetItem } from '../../components/ActionSheet';
import { FilterRow } from '../../components/FilterRow';
import { FolderTabs } from '../../components/FolderTabs';
import { ListRow } from '../../components/ListRow';
import { ScreenFrame } from '../../components/ScreenFrame';
import { SearchField } from '../../components/SearchField';
import { SectionHeader } from '../../components/SectionHeader';
import { Snackbar } from '../../components/Snackbar';
import { UpdateDialog } from '../../components/UpdateDialog';
import { IvyWreath } from '../../components/ornaments';
import {
  countTrashed,
  listRecipes,
  restoreRecipe,
  softDelete,
  togglePin,
} from '../../db/repository';
import type { RecipeListItem } from '../../db/types';
import { ptBR } from '../../i18n/pt-BR';
import type { UpdateManifest } from '../../lib/updateLogic';
import { checkForUpdateIfDue } from '../../lib/updater';
import { theme } from '../../theme';

type SnackbarState = {
  message: string;
  undoId?: string;
};

function EmptyState({ onPaste }: { onPaste: () => void }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyCard}>
        <IvyWreath />
        <Text style={styles.emptyTitle}>{ptBR.emptyTitle}</Text>
        <Text style={styles.emptyBody}>{ptBR.emptyBody}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={onPaste}
          style={({ pressed }) => [styles.emptyButton, pressed && styles.pressed]}
        >
          <Text style={styles.emptyButtonLabel}>{ptBR.pasteRecipe}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function RecipeListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<RecipeListItem[]>([]);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [trashCount, setTrashCount] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [menuItem, setMenuItem] = useState<RecipeListItem | null>(null);
  const [snackbar, setSnackbar] = useState<SnackbarState | null>(null);
  const [updateManifest, setUpdateManifest] = useState<UpdateManifest | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 150);
    return () => clearTimeout(timer);
  }, [query]);

  // Launch-time update check: at most once per 24 h, off the render path.
  // It only ever opens the dialog; the download waits for a user tap.
  useEffect(() => {
    let cancelled = false;

    checkForUpdateIfDue()
      .then((manifest) => {
        if (!cancelled && manifest) setUpdateManifest(manifest);
      })
      .catch((error: unknown) => {
        console.warn('[update] auto check failed:', error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(() => {
    setRefreshTick((tick) => tick + 1);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      Promise.all([
        listRecipes({ query: debouncedQuery, pinnedOnly }),
        countTrashed().catch((error: unknown) => {
          console.warn('[trash] count failed:', error);
          return 0;
        }),
      ])
        .then(([rows, trashed]) => {
          if (cancelled) return;
          setItems(rows);
          setTrashCount(trashed);
        })
        .catch((error: unknown) => {
          console.warn('[recipes] list failed:', error);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }, [debouncedQuery, pinnedOnly, refreshTick]),
  );

  const openRecipe = useCallback(
    (id: string) => {
      router.push(`/recipe/${id}`);
    },
    [router],
  );

  const handleTogglePin = useCallback(
    async (item: RecipeListItem) => {
      try {
        await togglePin(item.id);
        refresh();
      } catch (error) {
        console.warn('[recipes] pin failed:', error);
      }
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (item: RecipeListItem) => {
      try {
        const moved = await softDelete(item.id);
        if (!moved) return;
        refresh();
        setSnackbar({ message: ptBR.movedToTrash, undoId: item.id });
      } catch (error) {
        console.warn('[recipes] delete failed:', error);
      }
    },
    [refresh],
  );

  const handleUndo = useCallback(() => {
    const id = snackbar?.undoId;
    if (!id) return;

    restoreRecipe(id)
      .then(() => refresh())
      .catch((error: unknown) => {
        console.warn('[recipes] restore failed:', error);
      });
  }, [refresh, snackbar?.undoId]);

  const openItemMenu = useCallback((item: RecipeListItem) => {
    setMenuItem(item);
  }, []);

  const menu = menuItem;
  const menuItems: ActionSheetItem[] = menu
    ? [
        {
          label: menu.pinned === 1 ? ptBR.unpin : ptBR.pin,
          onPress: () => {
            setMenuItem(null);
            void handleTogglePin(menu);
          },
        },
        {
          label: ptBR.edit,
          onPress: () => {
            setMenuItem(null);
            router.push(`/edit/${menu.id}`);
          },
        },
        {
          label: ptBR.delete,
          tone: 'destructive',
          onPress: () => {
            setMenuItem(null);
            void handleDelete(menu);
          },
        },
      ]
    : [];

  const renderItem = useCallback(
    ({ item }: { item: RecipeListItem }) => (
      <ListRow item={item} onLongPress={openItemMenu} onPress={openRecipe} />
    ),
    [openItemMenu, openRecipe],
  );

  return (
    <ScreenFrame corners="top" tabs={<FolderTabs active="recipes" trashCount={trashCount} />}>
      <View style={styles.header}>
        <SearchField onChangeText={setQuery} value={query} />
        <SectionHeader title={ptBR.recipesHeader} />
        <FilterRow onChange={setPinnedOnly} pinnedOnly={pinnedOnly} />
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.oliveTab} />
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={items}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<EmptyState onPaste={() => router.push('/import')} />}
          renderItem={renderItem}
          style={styles.list}
        />
      )}

      {snackbar ? (
        <Snackbar
          key={snackbar.undoId ?? 'snackbar'}
          actionLabel={snackbar.undoId ? ptBR.undo : undefined}
          message={snackbar.message}
          onAction={snackbar.undoId ? handleUndo : undefined}
          onDismiss={() => setSnackbar(null)}
        />
      ) : null}

      <UpdateDialog
        manifest={updateManifest}
        visible={updateManifest !== null}
        onDismiss={() => setUpdateManifest(null)}
      />

      <ActionSheet
        cancelLabel={ptBR.cancel}
        items={menuItems}
        onDismiss={() => setMenuItem(null)}
        title={menu?.title}
        visible={menu !== null}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={ptBR.addRecipe}
        onPress={() => setSheetOpen(true)}
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
      >
        <Text style={styles.fabLabel}>+</Text>
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setSheetOpen(false)}
        statusBarTranslucent
        transparent
        visible={sheetOpen}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel={ptBR.cancel}
            accessibilityRole="button"
            onPress={() => setSheetOpen(false)}
            style={styles.backdrop}
          />

          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, theme.spacing.lg) }]}>
            <Text style={styles.sheetTitle}>{ptBR.addRecipe}</Text>

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setSheetOpen(false);
                router.push('/edit/new');
              }}
              style={({ pressed }) => [styles.sheetPrimary, pressed && styles.pressed]}
            >
              <Text style={styles.sheetPrimaryLabel}>{ptBR.newRecipe}</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setSheetOpen(false);
                router.push('/import');
              }}
              style={({ pressed }) => [styles.sheetSecondary, pressed && styles.pressed]}
            >
              <Text style={styles.sheetSecondaryLabel}>{ptBR.pasteRecipe}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
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
    paddingBottom: 112,
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
  emptyButton: {
    minHeight: 48,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
    borderRadius: 24,
    backgroundColor: theme.colors.oliveTab,
    marginTop: theme.spacing.xs,
  },
  emptyButtonLabel: {
    ...theme.typography.button,
    color: theme.colors.cream,
    textTransform: 'uppercase',
  },
  fab: {
    position: 'absolute',
    right: theme.spacing.lg,
    bottom: theme.spacing.xl,
    zIndex: 5,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.oliveTab,
    borderWidth: 2,
    borderColor: theme.colors.inkLight,
    elevation: 6,
    shadowColor: theme.colors.leafyDeep,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  fabPressed: {
    opacity: 0.85,
  },
  fabLabel: {
    ...theme.typography.recipeTitle,
    color: theme.colors.cream,
    fontSize: 30,
    lineHeight: 34,
  },
  pressed: {
    opacity: 0.7,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: theme.colors.leafyDeep,
    opacity: 0.55,
  },
  sheet: {
    gap: theme.spacing.sm,
    paddingTop: theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg,
    borderTopLeftRadius: theme.radii.lg,
    borderTopRightRadius: theme.radii.lg,
    backgroundColor: theme.colors.parchment,
    borderTopWidth: 1.5,
    borderColor: theme.colors.tan,
  },
  sheetTitle: {
    ...theme.typography.sectionTitle,
    color: theme.colors.ink,
    textAlign: 'center',
    marginBottom: theme.spacing.xs,
  },
  sheetPrimary: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: theme.colors.oliveTab,
    paddingHorizontal: theme.spacing.lg,
  },
  sheetPrimaryLabel: {
    ...theme.typography.button,
    color: theme.colors.cream,
    textTransform: 'uppercase',
  },
  sheetSecondary: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: theme.colors.inkLight,
    paddingHorizontal: theme.spacing.lg,
  },
  sheetSecondaryLabel: {
    ...theme.typography.button,
    color: theme.colors.ink,
    textTransform: 'uppercase',
  },
});
