import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ConfirmDialog } from '../components/ConfirmDialog';
import { ScreenFrame } from '../components/ScreenFrame';
import { createRecipe } from '../db/repository';
import { ptBR } from '../i18n/pt-BR';
import { pasteImport } from '../lib/pasteImport';
import { parseShareUrl } from '../lib/shareLink';
import { theme } from '../theme';

export default function ImportRecipeScreen() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const parsed = useMemo(() => pasteImport(text), [text]);
  const shareId = useMemo(() => parseShareUrl(text), [text]);
  const previewLines = useMemo(
    () => parsed.body.split('\n').slice(0, 4).join('\n'),
    [parsed.body],
  );

  const pasteFromClipboard = async () => {
    try {
      const value = await Clipboard.getStringAsync();
      if (value) setText(value);
    } catch (error) {
      console.warn('[import] clipboard read failed:', error);
    }
  };

  const create = async () => {
    if (!parsed.title) {
      setNotice(ptBR.titleRequired);
      return;
    }

    setSaving(true);
    try {
      const created = await createRecipe({ title: parsed.title, body: parsed.body });
      router.replace(`/recipe/${created.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice(message);
    } finally {
      setSaving(false);
    }
  };

  const openLink = useCallback(() => {
    if (shareId) router.push(`/r/${shareId}`);
  }, [router, shareId]);

  return (
    <ScreenFrame>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.topBar}>
          <Text style={styles.headerTitle}>{ptBR.pasteTitle}</Text>
          <Pressable accessibilityRole="button" onPress={() => router.back()}>
            <Text style={styles.link}>{ptBR.cancel}</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable accessibilityRole="button" onPress={() => void pasteFromClipboard()}>
            <Text style={styles.link}>{ptBR.pasteFromClipboard}</Text>
          </Pressable>

          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={ptBR.pastePlaceholder}
            placeholderTextColor={theme.colors.inkLight}
            style={styles.pasteInput}
            multiline
            textAlignVertical="top"
          />

          <Text style={styles.previewLabel}>{ptBR.previewTitle}</Text>
          <View style={styles.previewCard}>
            {shareId ? (
              <>
                <Text style={styles.previewTitle}>{ptBR.shareLinkTitle}</Text>
                <Text style={styles.previewMeta}>{ptBR.shareLinkDetected}</Text>
                <Text style={styles.linkValue} numberOfLines={2}>
                  {shareId}
                </Text>
              </>
            ) : parsed.title ? (
              <>
                <Text style={styles.previewTitle}>{parsed.title}</Text>
                <Text style={styles.previewMeta}>{ptBR.stepsLabel(parsed.stepCount)}</Text>
                <Text style={styles.previewBody} numberOfLines={6}>
                  {previewLines}
                </Text>
              </>
            ) : (
              <Text style={styles.previewBody}>{ptBR.previewEmpty}</Text>
            )}
          </View>
        </ScrollView>

        <View style={styles.actionBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{
              disabled: shareId ? false : saving || !parsed.title,
            }}
            disabled={shareId ? false : saving || !parsed.title}
            onPress={shareId ? openLink : () => void create()}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.buttonPressed,
              !shareId && (saving || !parsed.title) && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.primaryLabel}>
              {shareId ? ptBR.openLink : ptBR.createRecipe}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
          >
            <Text style={styles.secondaryLabel}>{ptBR.cancel}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <ConfirmDialog
        confirmLabel={ptBR.understood}
        noticeOnly
        onConfirm={() => setNotice(null)}
        onDismiss={() => setNotice(null)}
        title={notice ?? ''}
        visible={notice !== null}
      />
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.tan,
  },
  headerTitle: {
    ...theme.typography.sectionTitle,
    color: theme.colors.ink,
  },
  link: {
    ...theme.typography.button,
    color: theme.colors.ink,
    textDecorationLine: 'underline',
  },
  content: {
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    paddingBottom: theme.spacing.xxl,
  },
  pasteInput: {
    ...theme.typography.body,
    color: theme.colors.ink,
    backgroundColor: theme.colors.cream,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.tan,
    padding: theme.spacing.md,
    minHeight: 200,
  },
  previewLabel: {
    ...theme.typography.meta,
    color: theme.colors.inkLight,
    textTransform: 'uppercase',
  },
  previewCard: {
    backgroundColor: theme.colors.cream,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.tan,
    padding: theme.spacing.lg,
    gap: theme.spacing.xs,
  },
  previewTitle: {
    ...theme.typography.recipeTitle,
    color: theme.colors.ink,
  },
  previewMeta: {
    ...theme.typography.meta,
    color: theme.colors.inkLight,
  },
  previewBody: {
    ...theme.typography.bodySmall,
    color: theme.colors.inkLight,
  },
  linkValue: {
    ...theme.typography.meta,
    color: theme.colors.ink,
  },
  actionBar: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.tan,
  },
  primaryButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.oliveTab,
    paddingHorizontal: theme.spacing.lg,
  },
  primaryLabel: {
    ...theme.typography.button,
    color: theme.colors.cream,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.ink,
    paddingHorizontal: theme.spacing.lg,
  },
  secondaryLabel: {
    ...theme.typography.button,
    color: theme.colors.ink,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
});
