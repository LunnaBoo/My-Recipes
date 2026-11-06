import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ActionBar } from '../../components/ActionBar';
import { Markdown } from '../../components/Markdown';
import { ScreenFrame } from '../../components/ScreenFrame';
import { Seal } from '../../components/Seal';
import { SectionHeader } from '../../components/SectionHeader';
import { Snackbar } from '../../components/Snackbar';
import {
  createRecipe,
  getRecipeByActiveShareId,
  getRecipeBySourceShareId,
  updateRecipe,
} from '../../db/repository';
import type { Recipe } from '../../db/types';
import { ptBR } from '../../i18n/pt-BR';
import { fetchShare, type SharedRecipe, type ShareError } from '../../lib/api';
import { parseSeal } from '../../lib/seal';
import { isValidShareId } from '../../lib/shareLink';
import { theme } from '../../theme';

type LoadError = ShareError | 'invalid';

function errorMessage(error: LoadError): string {
  switch (error) {
    case 'not_found':
      return ptBR.shareUnavailable;
    case 'revoked':
      return ptBR.shareRevoked;
    case 'offline':
      return ptBR.offlineRetry;
    case 'invalid':
      return ptBR.invalidShareLink;
    case 'server_error':
    default:
      return ptBR.serverErrorRetry;
  }
}

function isRetryable(error: LoadError): boolean {
  return error === 'offline' || error === 'server_error';
}

/** Stores the sender seal exactly as it arrived, including a JSON `null`. */
function sealJson(seal: unknown): string | null {
  return seal === undefined ? null : JSON.stringify(seal);
}

export default function SharedRecipeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [share, setShare] = useState<SharedRecipe | null>(null);
  const [existing, setExisting] = useState<Recipe | null>(null);
  const [own, setOwn] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError | null>(null);
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const requestRef = useRef(0);
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    const ticket = requestRef.current + 1;
    requestRef.current = ticket;

    setLoading(true);
    setError(null);

    if (!isValidShareId(id)) {
      setError('invalid');
      setLoading(false);
      return;
    }

    try {
      const [result, local, owned] = await Promise.all([
        fetchShare(id),
        getRecipeBySourceShareId(id).catch((localError: unknown) => {
          console.warn('[share] local lookup failed:', localError);
          return null;
        }),
        getRecipeByActiveShareId(id).catch((ownError: unknown) => {
          console.warn('[share] own-share lookup failed:', ownError);
          return null;
        }),
      ]);

      if (requestRef.current !== ticket) return;

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setShare(result.recipe);
      setExisting(local);
      setOwn(owned);
    } finally {
      if (requestRef.current === ticket) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  const save = useCallback(async () => {
    if (!share || savingRef.current) return;

    savingRef.current = true;
    setSaving(true);
    setSnackbar(null);

    try {
      const created = await createRecipe({
        title: share.title,
        body: share.body,
        source: {
          shareId: id,
          name: share.sender,
          seal: sealJson(share.senderSeal),
        },
      });
      router.replace(`/recipe/${created.id}?notice=saved`);
    } catch (saveError) {
      console.warn('[share] save failed:', saveError);
      setSnackbar(ptBR.saveFailed);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [id, router, share]);

  const updateCopy = useCallback(async () => {
    if (!existing || !share || savingRef.current) return;

    savingRef.current = true;
    setSaving(true);
    setSnackbar(null);

    try {
      await updateRecipe(existing.id, { body: share.body });
      router.replace(`/recipe/${existing.id}?notice=updated`);
    } catch (updateError) {
      console.warn('[share] update failed:', updateError);
      setSnackbar(ptBR.updateFailed);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [existing, router, share]);

  const discard = useCallback(() => {
    router.replace('/');
  }, [router]);

  if (loading) {
    return (
      <ScreenFrame corners="diagonal">
        <View style={styles.centered}>
          <ActivityIndicator color={theme.colors.oliveTab} />
          <Text style={styles.loadingText}>{ptBR.openingLetter}</Text>
        </View>
      </ScreenFrame>
    );
  }

  if (error || !share) {
    const shown = error ?? 'server_error';

    return (
      <ScreenFrame corners="diagonal">
        <View style={styles.centered}>
          <Seal size={64} sigil="cat" />
          <Text style={styles.errorText}>{errorMessage(shown)}</Text>
          {isRetryable(shown) ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void load()}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            >
              <Text style={styles.retryLabel}>{ptBR.retry}</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" onPress={discard}>
            <Text style={styles.link}>{ptBR.discard}</Text>
          </Pressable>
        </View>
      </ScreenFrame>
    );
  }

  const localHash = existing?.content_hash ?? null;
  const hasNewerCopy = existing !== null && localHash !== share.contentHash;
  const senderSeal = parseSeal(share.senderSeal);

  const actions = own
    ? [
        {
          label: ptBR.viewRecipe,
          variant: 'primary' as const,
          onPress: () => router.replace(`/recipe/${own.id}`),
          accessibilityLabel: ptBR.viewRecipe,
        },
        {
          label: ptBR.discard,
          variant: 'danger' as const,
          onPress: discard,
          accessibilityLabel: ptBR.discard,
        },
      ]
    : existing
    ? [
        {
          label: ptBR.viewRecipe,
          variant: 'primary' as const,
          onPress: () => router.replace(`/recipe/${existing.id}`),
          accessibilityLabel: ptBR.viewRecipe,
        },
        ...(hasNewerCopy
          ? [
              {
                label: saving ? ptBR.updatingCopy : ptBR.updateCopy,
                variant: 'secondary' as const,
                onPress: () => void updateCopy(),
                accessibilityLabel: ptBR.updateCopy,
                disabled: saving,
              },
            ]
          : []),
        {
          label: ptBR.discard,
          variant: 'danger' as const,
          onPress: discard,
          accessibilityLabel: ptBR.discard,
        },
      ]
    : [
        {
          label: saving ? ptBR.savingRecipe : ptBR.save,
          variant: 'primary' as const,
          onPress: () => void save(),
          accessibilityLabel: ptBR.save,
          disabled: saving,
        },
        {
          label: ptBR.discard,
          variant: 'danger' as const,
          onPress: discard,
          accessibilityLabel: ptBR.discard,
        },
      ];

  return (
    <ScreenFrame corners="diagonal">
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        style={styles.flex}
      >
        <SectionHeader title={ptBR.newLetter} />

        <View style={styles.letter}>
          <View style={styles.sealWrap}>
            <Seal size={92} seal={senderSeal} />
          </View>

          <Text style={styles.letterFrom}>
            {share.sender ? ptBR.letterFrom(share.sender) : ptBR.sharedRecipe}
          </Text>
          <Text numberOfLines={2} style={styles.title}>
            {share.title}
          </Text>
          <Text style={styles.meta}>{ptBR.stepsLabel(share.stepCount)}</Text>

          <View style={styles.rule} />

          <Markdown markdown={share.body} />
        </View>

        {own ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>{ptBR.ownRecipe}</Text>
            <Text style={styles.noticeBody}>{ptBR.ownRecipeBody}</Text>
          </View>
        ) : existing ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>{ptBR.alreadyImported}</Text>
            {hasNewerCopy ? (
              <Text style={styles.noticeBody}>{ptBR.newerCopy}</Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <ActionBar actions={actions} />

      {snackbar ? (
        <Snackbar key={snackbar} message={snackbar} onDismiss={() => setSnackbar(null)} />
      ) : null}
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
  loadingText: {
    ...theme.typography.meta,
    color: theme.colors.inkLight,
  },
  errorText: {
    ...theme.typography.body,
    color: theme.colors.ink,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: 44,
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.lg,
    borderWidth: 1.5,
    borderColor: theme.colors.ink,
    paddingHorizontal: theme.spacing.lg,
  },
  retryLabel: {
    ...theme.typography.button,
    color: theme.colors.ink,
    textTransform: 'uppercase',
  },
  link: {
    ...theme.typography.button,
    color: theme.colors.ink,
    textDecorationLine: 'underline',
  },
  pressed: {
    opacity: 0.7,
  },
  content: {
    flexGrow: 1,
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
  },
  letter: {
    gap: theme.spacing.xs,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.cream,
    borderWidth: 1.5,
    borderColor: theme.colors.tan,
    borderRadius: theme.radii.lg,
  },
  sealWrap: {
    alignItems: 'center',
    paddingBottom: theme.spacing.sm,
  },
  letterFrom: {
    ...theme.typography.meta,
    color: theme.colors.inkLight,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  title: {
    ...theme.typography.recipeTitle,
    color: theme.colors.ink,
    textAlign: 'center',
  },
  meta: {
    ...theme.typography.meta,
    color: theme.colors.inkLight,
    textAlign: 'center',
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    opacity: 0.25,
    backgroundColor: theme.colors.inkLight,
    marginVertical: theme.spacing.sm,
  },
  notice: {
    gap: theme.spacing.xs,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.cream,
    borderWidth: 1.5,
    borderColor: theme.colors.gold,
    borderRadius: theme.radii.lg,
  },
  noticeTitle: {
    ...theme.typography.listTitle,
    color: theme.colors.ink,
  },
  noticeBody: {
    ...theme.typography.bodySmall,
    color: theme.colors.inkLight,
  },
});
