import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ActionSheet, type ActionSheetItem } from '../../components/ActionSheet';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FolderTabs } from '../../components/FolderTabs';
import { ScreenFrame } from '../../components/ScreenFrame';
import { Seal } from '../../components/Seal';
import { SectionHeader } from '../../components/SectionHeader';
import { Snackbar } from '../../components/Snackbar';
import { IvyWreath } from '../../components/ornaments';
import type { LetterRow } from '../../db/types';
import {
  countUnread,
  listLetters,
  markLetterRead,
  markLetterUnread,
  removeLetterLocal,
} from '../../db/mailboxRepository';
import { ptBR } from '../../i18n/pt-BR';
import { isMailboxApiError, removeLetter } from '../../lib/mailboxApi';
import {
  MailboxSessionError,
  ensureMailbox,
  refreshMailboxLetters,
} from '../../lib/mailboxSession';
import { sealFromStored } from '../../lib/seal';
import { theme } from '../../theme';

type MenuState =
  | { kind: 'none' }
  | { kind: 'letter'; letter: LetterRow }
  | { kind: 'confirm-remove'; letter: LetterRow };

function EmptyMailbox() {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyCard}>
        <IvyWreath />
        <Text style={styles.emptyTitle}>{ptBR.mailboxEmpty}</Text>
        <Text style={styles.emptyBody}>{ptBR.mailboxEmptyBody}</Text>
      </View>
    </View>
  );
}

function LetterRowView({
  item,
  onPress,
  onLongPress,
}: {
  item: LetterRow;
  onPress: (item: LetterRow) => void;
  onLongPress: (item: LetterRow) => void;
}) {
  const seal = sealFromStored(item.sender_seal);
  const unread = item.read_at === null || item.read_at === undefined;
  const available = item.available === 1;

  return (
    <Pressable
      accessibilityLabel={
        available
          ? ptBR.mailboxItemAccessibility(
              item.sender_name ?? ptBR.someone,
              item.title ?? ptBR.letterUnavailable,
              unread,
            )
          : ptBR.letterUnavailable
      }
      accessibilityRole="button"
      accessibilityHint={ptBR.mailboxItemHint}
      onLongPress={() => onLongPress(item)}
      onPress={() => onPress(item)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Seal seal={seal} size={44} />

      <View style={styles.body}>
        <Text style={styles.sender}>
          {available ? ptBR.letterFrom(item.sender_name ?? ptBR.someone) : ptBR.letterUnavailable}
        </Text>

        <Text numberOfLines={2} style={styles.title}>
          {available ? item.title ?? ptBR.letterUnavailable : ptBR.letterUnavailable}
        </Text>

        <View style={styles.meta}>
          <Text style={styles.metaText}>
            {available && item.step_count !== null
              ? `${ptBR.stepsLabel(item.step_count)} · ${ptBR.timeAgo(item.sent_at)}`
              : ptBR.timeAgo(item.sent_at)}
          </Text>
          {unread ? <View style={styles.unreadDot} /> : null}
        </View>
      </View>

      <View pointerEvents="none" style={styles.rule} />
    </Pressable>
  );
}

/** Cartas tab: the mailbox inbox. */
export default function MailboxScreen() {
  const router = useRouter();

  const [letters, setLetters] = useState<LetterRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [menu, setMenu] = useState<MenuState>({ kind: 'none' });
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const hasFocused = useRef(false);

  const loadLocal = useCallback(async () => {
    const [rows, count] = await Promise.all([listLetters(), countUnread()]);
    setLetters(rows);
    setUnread(count);
  }, []);

  const refresh = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent) setLoading(true);
      setOffline(false);

      try {
        const mailbox = await ensureMailbox();
        const result = await refreshMailboxLetters(mailbox);
        await loadLocal();

        if (!result.complete) {
          setOffline(true);
        }
      } catch (error) {
        console.warn('[mailbox] refresh failed:', error);
        await loadLocal();

        const code =
          error instanceof MailboxSessionError
            ? error.code
            : isMailboxApiError(error)
              ? error.code
              : null;

        if (code === 'offline') {
          setOffline(true);
        } else {
          setSnackbar(ptBR.mailboxLoadFailed);
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [loadLocal],
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const silent = hasFocused.current;
      hasFocused.current = true;

      refresh({ silent }).then(() => {
        if (cancelled) return;
      });

      return () => {
        cancelled = true;
      };
    }, [refresh]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh({ silent: true });
    setRefreshing(false);
  }, [refresh]);

  const handlePress = useCallback(
    async (item: LetterRow) => {
      const wasUnread = item.read_at === null || item.read_at === undefined;
      await markLetterRead(item.letter_id);

      if (wasUnread) {
        setUnread((count) => Math.max(0, count - 1));
        setLetters((rows) =>
          rows.map((row) =>
            row.letter_id === item.letter_id ? { ...row, read_at: Date.now() } : row,
          ),
        );
      }

      router.push(`/r/${item.share_id}?letter=${item.letter_id}&from=mailbox`);
    },
    [router],
  );

  const handleMarkRead = useCallback(async (item: LetterRow) => {
    setMenu({ kind: 'none' });
    const changed = await markLetterRead(item.letter_id);
    if (!changed) return;

    setLetters((rows) =>
      rows.map((row) =>
        row.letter_id === item.letter_id ? { ...row, read_at: Date.now() } : row,
      ),
    );
    setUnread((count) => Math.max(0, count - 1));
  }, []);

  const handleMarkUnread = useCallback(async (item: LetterRow) => {
    setMenu({ kind: 'none' });
    const changed = await markLetterUnread(item.letter_id);
    if (!changed) return;

    setLetters((rows) =>
      rows.map((row) =>
        row.letter_id === item.letter_id ? { ...row, read_at: null } : row,
      ),
    );
    setUnread((count) => count + 1);
  }, []);

  const handleRemove = useCallback(
    async (item: LetterRow) => {
      setMenu({ kind: 'none' });

      try {
        const mailbox = await ensureMailbox();
        await removeLetter({
          address: mailbox.address,
          secret: mailbox.secret,
          letterId: item.letter_id,
        });
        await removeLetterLocal(item.letter_id);
        await loadLocal();
      } catch (error) {
        console.warn('[mailbox] remove failed:', error);
        setSnackbar(ptBR.letterRemoveFailed);
      }
    },
    [loadLocal],
  );

  const openMenu = useCallback((letter: LetterRow) => {
    setMenu({ kind: 'letter', letter });
  }, []);

  const menuLetter = menu.kind === 'letter' ? menu.letter : null;
  const menuItems: ActionSheetItem[] = menuLetter
    ? [
        {
          label: menuLetter.read_at ? ptBR.markUnread : ptBR.markRead,
          onPress: () => {
            if (menuLetter.read_at) {
              void handleMarkUnread(menuLetter);
            } else {
              void handleMarkRead(menuLetter);
            }
          },
        },
        {
          label: ptBR.removeLetter,
          tone: 'destructive',
          onPress: () => setMenu({ kind: 'confirm-remove', letter: menuLetter }),
        },
      ]
    : [];

  const renderItem = useCallback(
    ({ item }: { item: LetterRow }) => (
      <LetterRowView item={item} onLongPress={openMenu} onPress={handlePress} />
    ),
    [handlePress, openMenu],
  );

  return (
    <ScreenFrame corners="top" tabs={<FolderTabs active="mailbox" mailboxCount={unread} />}>
      <View style={styles.header}>
        <SectionHeader title={ptBR.mailboxHeader} />
      </View>

      {offline ? (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>{ptBR.offlineNote}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.mauveTab} />
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={letters}
          keyExtractor={(item) => item.letter_id}
          ListEmptyComponent={<EmptyMailbox />}
          refreshControl={
            <RefreshControl
              colors={[theme.colors.mauveTab]}
              onRefresh={onRefresh}
              refreshing={refreshing}
              tintColor={theme.colors.mauveTab}
            />
          }
          renderItem={renderItem}
          style={styles.list}
        />
      )}

      {snackbar ? (
        <Snackbar key={snackbar} message={snackbar} onDismiss={() => setSnackbar(null)} />
      ) : null}

      <ActionSheet
        items={menuItems}
        onDismiss={() => setMenu({ kind: 'none' })}
        title={menuLetter?.title ?? undefined}
        visible={menu.kind === 'letter'}
      />

      <ConfirmDialog
        body={ptBR.removeLetterConfirmBody}
        cancelLabel={ptBR.cancel}
        confirmLabel={ptBR.removeLetter}
        destructive
        onConfirm={() => {
          if (menu.kind === 'confirm-remove') void handleRemove(menu.letter);
        }}
        onDismiss={() => setMenu({ kind: 'none' })}
        title={ptBR.removeLetterConfirmTitle}
        visible={menu.kind === 'confirm-remove'}
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
  offlineBanner: {
    marginHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.cream,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.tan,
  },
  offlineText: {
    ...theme.typography.meta,
    color: theme.colors.inkLight,
    textAlign: 'center',
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
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    minHeight: 84,
  },
  rowPressed: {
    backgroundColor: theme.colors.sageLight,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  sender: {
    ...theme.typography.meta,
    color: theme.colors.inkLight,
    textTransform: 'uppercase',
  },
  title: {
    ...theme.typography.listTitle,
    color: theme.colors.ink,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  metaText: {
    ...theme.typography.meta,
    color: theme.colors.inkLight,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.gold,
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
