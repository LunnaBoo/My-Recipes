import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ActionSheet, type ActionSheetItem } from '../../components/ActionSheet';
import { ActionBar } from '../../components/ActionBar';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Markdown } from '../../components/Markdown';
import { ScreenFrame } from '../../components/ScreenFrame';
import { Seal } from '../../components/Seal';
import { SectionHeader } from '../../components/SectionHeader';
import { Snackbar } from '../../components/Snackbar';
import {
  getActiveShare,
  getProfile,
  getRecipe,
  recordShare,
  softDelete,
  togglePin,
} from '../../db/repository';
import type { Profile, Recipe } from '../../db/types';
import { ptBR } from '../../i18n/pt-BR';
import { createShare, shareUrlFor, updateShare } from '../../lib/api';
import { sealFromStored, sealToPayload } from '../../lib/seal';
import { buildShareMessage, isValidShareId } from '../../lib/shareLink';
import { theme } from '../../theme';

type SnackbarState = {
  message: string;
  retry?: boolean;
};

function formatDate(timestamp: number | null): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}

export default function RecipeViewScreen() {
  const { id, notice } = useLocalSearchParams<{ id: string; notice?: string }>();
  const router = useRouter();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [snackbar, setSnackbar] = useState<SnackbarState | null>(null);
  const sharingRef = useRef(false);

  useEffect(() => {
    if (notice === 'saved') setSnackbar({ message: ptBR.recipeSaved });
    else if (notice === 'updated') setSnackbar({ message: ptBR.copyUpdated });
  }, [notice]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      Promise.all([getRecipe(id), getProfile()])
        .then(([found, loadedProfile]) => {
          if (cancelled) return;
          setRecipe(found);
          setProfile(loadedProfile);
        })
        .catch((error: unknown) => {
          console.warn('[recipe] load failed:', error);
        })
        .finally(() => {
          if (!cancelled) setLoaded(true);
        });

      return () => {
        cancelled = true;
      };
    }, [id]),
  );

  const reload = useCallback(async () => {
    const updated = await getRecipe(id);
    if (updated) setRecipe(updated);
  }, [id]);

  const confirmDelete = useCallback(() => {
    softDelete(id)
      .then(() => router.back())
      .catch((error: unknown) => {
        console.warn('[recipe] delete failed:', error);
      });
  }, [id, router]);

  const handleTogglePin = useCallback(() => {
    if (!recipe) return;

    togglePin(recipe.id)
      .then(() => reload())
      .catch((error: unknown) => {
        console.warn('[recipe] pin failed:', error);
      });
  }, [recipe, reload]);

  const openMenu = useCallback(() => {
    if (!recipe) return;
    setMenuOpen(true);
  }, [recipe]);

  const copyRecipe = useCallback(async () => {
    if (!recipe) return;
    try {
      await Clipboard.setStringAsync(`*${recipe.title}*\n\n${recipe.body}`);
      setSnackbar({ message: ptBR.copied });
    } catch (error) {
      console.warn('[recipe] copy failed:', error);
    }
  }, [recipe]);

  const shareRecipe = useCallback(async () => {
    if (!recipe || sharingRef.current) return;

    sharingRef.current = true;
    setSharing(true);
    setSnackbar(null);

    try {
      const active = await getActiveShare(recipe.id);
      const profileSeal = profile ? sealFromStored(profile.sealJson) : null;
      const senderSeal = profileSeal ? sealToPayload(profileSeal) : undefined;
      let shareId: string;

      if (active && isValidShareId(active.share_id)) {
        shareId = active.share_id;
        // Refresh the published copy so the link never serves stale text.
        await updateShare(shareId, {
          title: recipe.title,
          body: recipe.body,
          sender: profile?.displayName.trim() || ptBR.someone,
          senderSeal,
        });
      } else {
        const created = await createShare({
          id: recipe.id,
          title: recipe.title,
          body: recipe.body,
          sender: profile?.displayName.trim() || ptBR.someone,
          senderSeal,
        });
        await recordShare(recipe.id, created.id);
        shareId = created.id;
      }

      await Share.share({
        message: buildShareMessage(recipe.title, recipe.step_count, shareUrlFor(shareId)),
      });
    } catch (error) {
      console.warn('[recipe] share failed:', error);
      setSnackbar({ message: ptBR.shareFailed, retry: true });
    } finally {
      sharingRef.current = false;
      setSharing(false);
    }
  }, [profile, recipe]);

  if (!loaded) {
    return (
      <ScreenFrame corners="diagonal">
        <View style={styles.centered}>
          <ActivityIndicator color={theme.colors.oliveTab} />
        </View>
      </ScreenFrame>
    );
  }

  if (!recipe) {
    return (
      <ScreenFrame corners="diagonal">
        <View style={styles.centered}>
          <Text style={styles.notFound}>{ptBR.recipeNotFound}</Text>
          <Pressable accessibilityRole="button" onPress={() => router.back()}>
            <Text style={styles.link}>{ptBR.back}</Text>
          </Pressable>
        </View>
      </ScreenFrame>
    );
  }

  const imported =
    recipe.source_share_id !== null ||
    recipe.source_name !== null ||
    recipe.imported_at !== null;
  const sender = recipe.source_name;
  const importedDate = formatDate(recipe.imported_at);
  const sourceSeal = imported ? sealFromStored(recipe.source_seal) : null;

  let meta = ptBR.stepsLabel(recipe.step_count);
  if (imported && sender) {
    meta = importedDate
      ? `${meta} · ${ptBR.importedFrom(sender, importedDate)}`
      : meta;
  } else if (profile?.displayName) {
    meta = ptBR.stepsBy(recipe.step_count, profile.displayName);
  }

  const menuItems: ActionSheetItem[] = [
    {
      label: recipe.pinned === 1 ? ptBR.unpin : ptBR.pin,
      onPress: () => {
        setMenuOpen(false);
        handleTogglePin();
      },
    },
    {
      label: ptBR.delete,
      tone: 'destructive',
      onPress: () => {
        setMenuOpen(false);
        setDeleteOpen(true);
      },
    },
  ];

  return (
    <ScreenFrame corners="diagonal">
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        style={styles.flex}
      >
        <SectionHeader title={ptBR.recipeHeader} />

        {imported ? (
          <>
            <View style={styles.headerRow}>
              <View style={styles.sender}>
                <Seal size={28} seal={sourceSeal} />
                {sender ? <Text style={styles.letterFrom}>{ptBR.letterFrom(sender)}</Text> : null}
              </View>

              <Pressable
                accessibilityLabel={ptBR.moreOptions}
                accessibilityRole="button"
                hitSlop={8}
                onPress={openMenu}
                style={({ pressed }) => [styles.overflow, pressed && styles.pressed]}
              >
                <Text style={styles.overflowLabel}>⋯</Text>
              </Pressable>
            </View>

            <Text numberOfLines={2} onLongPress={openMenu} style={styles.title}>
              {recipe.title}
            </Text>
            <Text style={styles.meta}>{meta}</Text>
            <View style={styles.rule} />

            <Markdown markdown={recipe.body} />
          </>
        ) : (
          <View style={styles.card}>
            <Pressable
              accessibilityLabel={ptBR.moreOptions}
              accessibilityRole="button"
              hitSlop={8}
              onPress={openMenu}
              style={({ pressed }) => [
                styles.overflow,
                styles.cardOverflow,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.overflowLabel}>⋯</Text>
            </Pressable>

            <View style={styles.sealWrap}>
              <Seal size={108} seal={sealFromStored(profile?.sealJson ?? null)} />
            </View>

            <Text style={styles.recipeBy}>
              {profile?.displayName.trim()
                ? ptBR.recipeBy(profile.displayName.trim())
                : ptBR.yourRecipe}
            </Text>

            <Text
              numberOfLines={2}
              onLongPress={openMenu}
              style={[styles.title, styles.titleCentered]}
            >
              {recipe.title}
            </Text>
            <Text style={[styles.meta, styles.metaCentered]}>
              {ptBR.stepsLabel(recipe.step_count)}
            </Text>
            <View style={styles.rule} />

            <Markdown markdown={recipe.body} />
          </View>
        )}
      </ScrollView>

      <ActionBar
        actions={[
          {
            label: sharing ? ptBR.creatingLink : ptBR.send,
            variant: 'primary',
            onPress: () => void shareRecipe(),
            accessibilityLabel: ptBR.send,
            disabled: sharing,
          },
          {
            label: ptBR.copy,
            variant: 'secondary',
            onPress: () => void copyRecipe(),
            accessibilityLabel: ptBR.copy,
          },
          {
            label: ptBR.edit,
            variant: 'secondary',
            onPress: () => router.push(`/edit/${recipe.id}`),
            accessibilityLabel: ptBR.edit,
          },
        ]}
      />
      {snackbar ? (
        <Snackbar
          key={snackbar.message}
          actionLabel={snackbar.retry ? ptBR.retry : undefined}
          message={snackbar.message}
          onAction={snackbar.retry ? () => void shareRecipe() : undefined}
          onDismiss={() => setSnackbar(null)}
        />
      ) : null}

      <ActionSheet
        items={menuItems}
        onDismiss={() => setMenuOpen(false)}
        title={recipe.title}
        visible={menuOpen}
      />

      <ConfirmDialog
        body={ptBR.deleteConfirmBody}
        cancelLabel={ptBR.cancel}
        confirmLabel={ptBR.deleteConfirmAction}
        destructive
        onConfirm={() => {
          setDeleteOpen(false);
          confirmDelete();
        }}
        onDismiss={() => setDeleteOpen(false)}
        title={ptBR.deleteConfirmTitle}
        visible={deleteOpen}
      />
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.xl,
  },
  notFound: {
    ...theme.typography.body,
    color: theme.colors.ink,
    textAlign: 'center',
  },
  link: {
    ...theme.typography.button,
    color: theme.colors.ink,
    textDecorationLine: 'underline',
  },
  content: {
    flexGrow: 1,
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
  },
  headerRow: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  sender: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  letterFrom: {
    ...theme.typography.meta,
    color: theme.colors.inkLight,
    textTransform: 'uppercase',
  },
  overflow: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowLabel: {
    ...theme.typography.recipeTitle,
    color: theme.colors.ink,
    fontSize: 24,
    lineHeight: 26,
  },
  pressed: {
    opacity: 0.6,
  },
  title: {
    ...theme.typography.recipeTitle,
    color: theme.colors.ink,
  },
  meta: {
    ...theme.typography.meta,
    color: theme.colors.inkLight,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    opacity: 0.25,
    backgroundColor: theme.colors.inkLight,
    marginVertical: theme.spacing.sm,
  },
  card: {
    gap: theme.spacing.xs,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.cream,
    borderWidth: 1.5,
    borderColor: theme.colors.tan,
    borderRadius: theme.radii.lg,
  },
  cardOverflow: {
    position: 'absolute',
    top: 0,
    right: 0,
  },
  sealWrap: {
    alignItems: 'center',
    paddingBottom: theme.spacing.sm,
  },
  recipeBy: {
    ...theme.typography.meta,
    color: theme.colors.inkLight,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  titleCentered: {
    textAlign: 'center',
  },
  metaCentered: {
    textAlign: 'center',
  },
});
