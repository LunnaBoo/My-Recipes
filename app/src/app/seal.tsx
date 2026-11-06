import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { FolderTabs } from '../components/FolderTabs';
import { ScreenFrame } from '../components/ScreenFrame';
import { Seal } from '../components/Seal';
import { getProfile, saveProfile } from '../db/repository';
import { ptBR } from '../i18n/pt-BR';
import {
  MAX_SEAL_BYTES,
  SIGIL_IDS,
  base64ByteLength,
  parseSeal,
  sealFromStored,
  sealToStored,
  type Seal as SealValue,
  type SigilId,
} from '../lib/seal';
import { theme } from '../theme';

/** 256×256 @ 0.7 first; smaller/lighter retries only when the bytes are over 32 KB. */
const IMAGE_ATTEMPTS = [
  { size: 256, compress: 0.7 },
  { size: 256, compress: 0.5 },
  { size: 192, compress: 0.5 },
] as const;

async function encodeJpeg(uri: string, size: number, compress: number): Promise<string | null> {
  const context = ImageManipulator.manipulate(uri, { maxWidth: 1024, maxHeight: 1024 });
  context.resize({ width: size, height: size });
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({
    base64: true,
    compress,
    format: SaveFormat.JPEG,
  });
  return result.base64 ?? null;
}

/** Re-encodes the picked photo to fit the 32 KB wire cap, or returns null. */
async function buildImageSeal(uri: string): Promise<SealValue | null> {
  for (const attempt of IMAGE_ATTEMPTS) {
    const data = await encodeJpeg(uri, attempt.size, attempt.compress);
    if (!data) continue;

    const bytes = base64ByteLength(data);
    if (bytes === null || bytes > MAX_SEAL_BYTES) continue;

    const parsed = parseSeal({ kind: 'image', mime: 'image/jpeg', data });
    if (parsed) return parsed;
  }

  return null;
}

export default function SealScreen() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [seal, setSeal] = useState<SealValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageError, setMessageError] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      getProfile()
        .then((profile) => {
          if (cancelled) return;
          setDisplayName(profile.displayName);
          setSeal(sealFromStored(profile.sealJson));
        })
        .catch((error: unknown) => {
          console.warn('[seal] profile load failed:', error);
        });

      return () => {
        cancelled = true;
      };
    }, []),
  );

  const showMessage = useCallback((text: string, error = false) => {
    setMessage(text);
    setMessageError(error);
  }, []);

  const commitProfile = useCallback(
    async (nextSeal: SealValue | null, nextName: string) => {
      const saved = await saveProfile({
        displayName: nextName,
        sealJson: nextSeal ? sealToStored(nextSeal) : null,
      });
      setDisplayName(saved.displayName);
      setSeal(sealFromStored(saved.sealJson));
    },
    [],
  );

  const persistDisplayName = useCallback(async () => {
    try {
      await commitProfile(seal, displayName);
    } catch (error) {
      console.warn('[seal] display name save failed:', error);
      showMessage(ptBR.nameSaveFailed, true);
    }
  }, [commitProfile, displayName, seal, showMessage]);

  const chooseSigil = useCallback(
    async (id: SigilId) => {
      if (busy) return;

      const previous = seal;
      const next: SealValue = { kind: 'sigil', id };

      setBusy(true);
      setSeal(next);
      setMessage(null);

      try {
        await commitProfile(next, displayName);
        showMessage(ptBR.sealSaved);
      } catch (error) {
        console.warn('[seal] sigil save failed:', error);
        setSeal(previous);
        showMessage(ptBR.sealSaveFailed, true);
      } finally {
        setBusy(false);
      }
    },
    [busy, commitProfile, displayName, seal, showMessage],
  );

  const pickImage = useCallback(async () => {
    if (busy) return;

    setMessage(null);

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showMessage(ptBR.sealPermissionDenied, true);
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });

      if (result.canceled) return;
      const uri = result.assets?.[0]?.uri;
      if (!uri) return;

      setBusy(true);

      let next: SealValue | null;
      try {
        next = await buildImageSeal(uri);
      } catch (error) {
        console.warn('[seal] image manipulation failed:', error);
        showMessage(ptBR.sealImageFailed, true);
        return;
      }

      if (!next) {
        showMessage(ptBR.sealImageTooLarge, true);
        return;
      }

      const previous = seal;
      setSeal(next);

      try {
        await commitProfile(next, displayName);
        showMessage(ptBR.sealImageSaved);
      } catch (error) {
        console.warn('[seal] image seal save failed:', error);
        setSeal(previous);
        showMessage(ptBR.sealSaveFailed, true);
      }
    } catch (error) {
      console.warn('[seal] image picker failed:', error);
      showMessage(ptBR.sealImageFailed, true);
    } finally {
      setBusy(false);
    }
  }, [busy, commitProfile, displayName, seal, showMessage]);

  return (
    <ScreenFrame corners="top" tabs={<FolderTabs active="settings" />}>
      <View style={styles.topBar}>
        <Text style={styles.headerTitle}>{ptBR.sealTitle}</Text>
        <Pressable
          accessibilityLabel={ptBR.back}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.back()}
          style={styles.backHit}
        >
          <Text style={styles.link}>{ptBR.back}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.previewLabel}>{ptBR.sealPreviewLabel}</Text>
        <View style={styles.preview}>
          <Seal size={96} seal={seal} />
        </View>

        {message ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.message, messageError && styles.messageError]}
          >
            {message}
          </Text>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.label}>{ptBR.displayNameLabel}</Text>
          <TextInput
            maxLength={40}
            onBlur={() => void persistDisplayName()}
            onChangeText={setDisplayName}
            onSubmitEditing={() => void persistDisplayName()}
            placeholder={ptBR.displayNamePlaceholder}
            placeholderTextColor={theme.colors.inkLight}
            returnKeyType="done"
            style={styles.input}
            value={displayName}
          />
        </View>

        <Text style={styles.hint}>{ptBR.sealHint}</Text>

        <View style={styles.grid}>
          {SIGIL_IDS.map((id) => {
            const selected = seal?.kind === 'sigil' && seal.id === id;
            const name = ptBR.sealSigilNames[id];

            return (
              <Pressable
                key={id}
                accessibilityLabel={selected ? ptBR.sealSigilSelected(name) : name}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: busy }}
                disabled={busy}
                onPress={() => void chooseSigil(id)}
                style={({ pressed }) => [
                  styles.sigilCell,
                  selected && styles.sigilCellSelected,
                  pressed && styles.pressed,
                  busy && styles.disabled,
                ]}
              >
                <Seal size={56} sigil={id} />
              </Pressable>
            );
          })}
        </View>

        <Pressable
          accessibilityLabel={ptBR.sealSendImage}
          accessibilityRole="button"
          accessibilityState={{ busy, disabled: busy }}
          disabled={busy}
          onPress={() => void pickImage()}
          style={({ pressed }) => [
            styles.imageButton,
            pressed && styles.pressed,
            busy && styles.disabled,
          ]}
        >
          {busy ? <ActivityIndicator color={theme.colors.cream} size="small" /> : null}
          <Text style={styles.imageButtonLabel}>
            {busy ? ptBR.sealPreparingImage : ptBR.sealSendImage}
          </Text>
        </Pressable>
      </ScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.tan,
  },
  headerTitle: {
    ...theme.typography.sectionTitle,
    color: theme.colors.ink,
    flexShrink: 1,
  },
  link: {
    ...theme.typography.button,
    color: theme.colors.ink,
    textDecorationLine: 'underline',
  },
  backHit: {
    minHeight: 48,
    minWidth: 48,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  content: {
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    paddingBottom: theme.spacing.xxl,
  },
  previewLabel: {
    ...theme.typography.meta,
    color: theme.colors.inkLight,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  preview: {
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
  },
  message: {
    ...theme.typography.bodySmall,
    color: theme.colors.oliveTab,
    textAlign: 'center',
  },
  messageError: {
    color: theme.colors.maroon,
  },
  card: {
    gap: theme.spacing.xs,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.cream,
    borderWidth: 1.5,
    borderColor: theme.colors.tan,
    borderRadius: theme.radii.lg,
  },
  label: {
    ...theme.typography.meta,
    color: theme.colors.inkLight,
    textTransform: 'uppercase',
  },
  input: {
    ...theme.typography.body,
    color: theme.colors.ink,
    backgroundColor: theme.colors.cream,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.tan,
    paddingHorizontal: theme.spacing.md,
    minHeight: 48,
  },
  hint: {
    ...theme.typography.bodySmall,
    color: theme.colors.inkLight,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: theme.spacing.md,
  },
  sigilCell: {
    width: '31%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.parchment,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  sigilCellSelected: {
    backgroundColor: theme.colors.cream,
    borderColor: theme.colors.gold,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.4,
  },
  imageButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.oliveTab,
    paddingHorizontal: theme.spacing.lg,
  },
  imageButtonLabel: {
    ...theme.typography.button,
    color: theme.colors.cream,
    textTransform: 'uppercase',
  },
});
