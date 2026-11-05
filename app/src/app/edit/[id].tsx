import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  Keyboard,
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
import { Markdown } from '../../components/Markdown';
import { ScreenFrame } from '../../components/ScreenFrame';
import { createRecipe, getRecipe, updateRecipe } from '../../db/repository';
import { ptBR } from '../../i18n/pt-BR';
import {
  applyEditorAction,
  type EditorAction,
  type Selection,
} from '../../lib/editorActions';
import { theme } from '../../theme';

type Mode = 'edit' | 'preview';

const TOOLBAR: { action: EditorAction; label: string; hint: string }[] = [
  { action: 'bold', label: 'B', hint: ptBR.bold },
  { action: 'italic', label: 'I', hint: ptBR.italic },
  { action: 'heading', label: 'H2', hint: ptBR.headingAction },
  { action: 'bulleted', label: '•', hint: ptBR.bulleted },
  { action: 'numbered', label: '1.', hint: ptBR.numbered },
  { action: 'checkbox', label: '[ ]', hint: ptBR.checkbox },
  { action: 'divider', label: '—', hint: ptBR.divider },
];

export default function EditRecipeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const isNew = id === 'new';

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [ready, setReady] = useState(isNew);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('edit');
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  const [pendingSelection, setPendingSelection] = useState<Selection | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);

  const bodyRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [initial, setInitial] = useState({ title: '', body: '' });

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
        setInitial({ title: recipe.title, body: recipe.body });
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

  const dirty = title !== initial.title || body !== initial.body;

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
        setInitial({ title, body });
        router.back();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice(message);
    } finally {
      setSaving(false);
    }
  }, [body, id, isNew, router, title]);

  const autosave = useCallback(() => {
    if (isNew || !ready || saving) return;
    if (!title.trim()) return;
    if (title === initial.title && body === initial.body) return;

    updateRecipe(id, { title, body })
      .then(() => {
        setInitial({ title, body });
      })
      .catch((error: unknown) => {
        console.warn('[editor] autosave failed:', error);
      });
  }, [body, id, initial.body, initial.title, isNew, ready, saving, title]);

  const requestClose = useCallback(() => {
    Keyboard.dismiss();
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    router.back();
  }, [dirty, router]);

  const apply = useCallback(
    (action: EditorAction) => {
      const result = applyEditorAction(body, selection, action);
      setBody(result.text);
      setPendingSelection(result.selection);
      bodyRef.current?.focus();
    },
    [body, selection],
  );

  const switchMode = useCallback((next: Mode) => {
    Keyboard.dismiss();
    setMode(next);
  }, []);

  return (
    <ScreenFrame>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={styles.topBar}>
          <Pressable accessibilityRole="button" onPress={requestClose}>
            <Text style={styles.link}>{ptBR.cancel}</Text>
          </Pressable>

          <View accessibilityRole="tablist" style={styles.segments}>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === 'edit' }}
              onPress={() => switchMode('edit')}
              style={[styles.segment, mode === 'edit' && styles.segmentActive]}
            >
              <Text style={[styles.segmentLabel, mode === 'edit' && styles.segmentLabelActive]}>
                {ptBR.edit}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === 'preview' }}
              onPress={() => switchMode('preview')}
              style={[styles.segment, mode === 'preview' && styles.segmentActive]}
            >
              <Text
                style={[styles.segmentLabel, mode === 'preview' && styles.segmentLabelActive]}
              >
                {ptBR.previewShort}
              </Text>
            </Pressable>
          </View>

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
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.fieldLabel}>{ptBR.titleLabel}</Text>
          <TextInput
            editable={ready}
            maxLength={120}
            onBlur={autosave}
            onChangeText={setTitle}
            placeholder={ptBR.titlePlaceholder}
            placeholderTextColor={theme.colors.inkLight}
            style={styles.titleInput}
            value={title}
          />

          {mode === 'edit' ? (
            <>
              <ScrollView
                contentContainerStyle={styles.toolbarContent}
                horizontal
                keyboardShouldPersistTaps="always"
                showsHorizontalScrollIndicator={false}
                style={styles.toolbar}
              >
                {TOOLBAR.map((item) => (
                  <Pressable
                    accessibilityLabel={item.hint}
                    accessibilityRole="button"
                    key={item.action}
                    onPress={() => apply(item.action)}
                    style={({ pressed }) => [
                      styles.toolButton,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Text style={styles.toolLabel}>{item.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <TextInput
                editable={ready}
                multiline
                onBlur={autosave}
                onChangeText={setBody}
                onSelectionChange={(event) => {
                  setSelection(event.nativeEvent.selection);
                  if (pendingSelection) setPendingSelection(null);
                }}
                placeholder={ptBR.bodyPlaceholder}
                placeholderTextColor={theme.colors.inkLight}
                ref={bodyRef}
                selection={pendingSelection ?? undefined}
                style={styles.bodyInput}
                textAlignVertical="top"
                value={body}
              />
            </>
          ) : (
            <View style={styles.preview}>
              {body.trim() ? (
                <Markdown markdown={body} />
              ) : (
                <Text style={styles.previewEmpty}>{ptBR.previewEmpty}</Text>
              )}
            </View>
          )}
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

      <ConfirmDialog
        body={ptBR.discardBody}
        cancelLabel={ptBR.keepEditing}
        confirmLabel={ptBR.discardAction}
        destructive
        onConfirm={() => {
          setDiscardOpen(false);
          router.back();
        }}
        onDismiss={() => setDiscardOpen(false)}
        title={ptBR.discardTitle}
        visible={discardOpen}
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
    gap: theme.spacing.sm,
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
  segments: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: theme.colors.tan,
    borderRadius: theme.radii.md,
    overflow: 'hidden',
  },
  segment: {
    minHeight: 40,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.cream,
  },
  segmentActive: {
    backgroundColor: theme.colors.oliveTab,
  },
  segmentLabel: {
    ...theme.typography.meta,
    color: theme.colors.ink,
    textTransform: 'uppercase',
  },
  segmentLabelActive: {
    color: theme.colors.cream,
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
  toolbar: {
    flexGrow: 0,
    marginTop: theme.spacing.xs,
  },
  toolbarContent: {
    gap: theme.spacing.sm,
    paddingVertical: 2,
  },
  toolButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.tan,
    backgroundColor: theme.colors.cream,
  },
  toolLabel: {
    ...theme.typography.button,
    color: theme.colors.ink,
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
  preview: {
    minHeight: 320,
    padding: theme.spacing.md,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.tan,
    backgroundColor: theme.colors.cream,
  },
  previewEmpty: {
    ...theme.typography.bodySmall,
    color: theme.colors.inkLight,
  },
});
