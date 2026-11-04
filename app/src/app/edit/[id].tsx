import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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

import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ScreenFrame } from '../../components/ScreenFrame';
import { createRecipe, getRecipe, updateRecipe } from '../../db/repository';
import { ptBR } from '../../i18n/pt-BR';
import { theme } from '../../theme';

export default function EditRecipeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const isNew = id === 'new';

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [ready, setReady] = useState(isNew);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) {
      setReady(true);
      return;
    }

    let cancelled = false;
    getRecipe(id)
      .then((recipe) => {
        if (cancelled || !recipe) return;
        setTitle(recipe.title);
        setBody(recipe.body);
      })
      .catch((error: unknown) => {
        console.warn('[editor] load failed:', error);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [id, isNew]);

  const save = useCallback(async () => {
    if (!title.trim()) {
      setNotice(ptBR.titleRequired);
      return;
    }

    setSaving(true);
    try {
      if (isNew) {
        const created = await createRecipe({ title, body });
        router.replace(`/recipe/${created.id}`);
      } else {
        await updateRecipe(id, { title, body });
        router.back();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice(message);
    } finally {
      setSaving(false);
    }
  }, [body, id, isNew, router, title]);

  return (
    <ScreenFrame>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.topBar}>
          <Pressable accessibilityRole="button" onPress={() => router.back()}>
            <Text style={styles.link}>{ptBR.cancel}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: saving || !ready }}
            disabled={saving || !ready}
            onPress={() => void save()}
            style={({ pressed }) => [
              styles.saveButton,
              pressed && styles.buttonPressed,
              (saving || !ready) && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.saveLabel}>{ptBR.save}</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <Text style={styles.fieldLabel}>{ptBR.titleLabel}</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={ptBR.titlePlaceholder}
            placeholderTextColor={theme.colors.inkLight}
            style={styles.titleInput}
            maxLength={120}
            editable={ready}
          />

          <Text style={styles.fieldLabel}>{ptBR.bodyLabel}</Text>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder={ptBR.bodyPlaceholder}
            placeholderTextColor={theme.colors.inkLight}
            style={styles.bodyInput}
            multiline
            textAlignVertical="top"
            editable={ready}
          />
        </ScrollView>
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
  link: {
    ...theme.typography.button,
    color: theme.colors.ink,
    textDecorationLine: 'underline',
  },
  saveButton: {
    minHeight: 44,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.oliveTab,
    paddingHorizontal: theme.spacing.lg,
  },
  saveLabel: {
    ...theme.typography.button,
    color: theme.colors.cream,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  content: {
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.xxl,
  },
  fieldLabel: {
    ...theme.typography.meta,
    color: theme.colors.inkLight,
    textTransform: 'uppercase',
  },
  titleInput: {
    ...theme.typography.recipeTitle,
    color: theme.colors.ink,
    backgroundColor: theme.colors.cream,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.tan,
    padding: theme.spacing.md,
    minHeight: 48,
  },
  bodyInput: {
    ...theme.typography.body,
    color: theme.colors.ink,
    backgroundColor: theme.colors.cream,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.tan,
    padding: theme.spacing.md,
    minHeight: 320,
  },
});
