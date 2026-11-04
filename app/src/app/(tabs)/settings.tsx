import Constants from 'expo-constants';
import { useFocusEffect } from 'expo-router';
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

import { FolderTabs } from '../../components/FolderTabs';
import { ScreenFrame } from '../../components/ScreenFrame';
import { SectionHeader } from '../../components/SectionHeader';
import { UpdateDialog } from '../../components/UpdateDialog';
import { countTrashed, getProfile, saveProfile } from '../../db/repository';
import type { Profile } from '../../db/types';
import { ptBR } from '../../i18n/pt-BR';
import type { UpdateManifest } from '../../lib/updateLogic';
import { checkForUpdate, recordUpdateCheck, UpdateError } from '../../lib/updater';
import { theme } from '../../theme';

/** Settings root inside the parchment shell; editing lands in its own lane. */
export default function SettingsScreen() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [trashCount, setTrashCount] = useState(0);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<string | null>(null);
  const [updateManifest, setUpdateManifest] = useState<UpdateManifest | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      Promise.all([
        getProfile().catch((error: unknown) => {
          console.warn('[settings] profile failed:', error);
          return null;
        }),
        countTrashed().catch((error: unknown) => {
          console.warn('[settings] trash count failed:', error);
          return 0;
        }),
      ])
        .then(([loadedProfile, trashed]) => {
          if (cancelled) return;
          setProfile(loadedProfile);
          setDisplayName(loadedProfile?.displayName ?? '');
          setTrashCount(trashed);
        })
        .catch((error: unknown) => {
          console.warn('[settings] load failed:', error);
        });

      return () => {
        cancelled = true;
      };
    }, []),
  );

  const persistDisplayName = useCallback(async () => {
    try {
      const saved = await saveProfile({
        displayName,
        sealJson: profile?.sealJson ?? null,
      });
      setProfile(saved);
      setDisplayName(saved.displayName);
    } catch (error) {
      console.warn('[settings] save profile failed:', error);
    }
  }, [displayName, profile?.sealJson]);

  const handleCheckUpdate = useCallback(async () => {
    if (checkingUpdate) return;

    setCheckingUpdate(true);
    setUpdateResult(null);

    try {
      await recordUpdateCheck();
      const result = await checkForUpdate();

      if (result.status === 'update') {
        setUpdateManifest(result.manifest);
        setUpdateResult(ptBR.updateAvailableInline(result.manifest.versionName));
      } else if (result.status === 'current') {
        setUpdateResult(ptBR.updateUpToDate);
      } else {
        setUpdateResult(ptBR.updateUnknownVersion);
      }
    } catch (error) {
      const code = error instanceof UpdateError ? error.code : 'server';
      setUpdateResult(code === 'offline' ? ptBR.updateOffline : ptBR.updateServer);
    } finally {
      setCheckingUpdate(false);
    }
  }, [checkingUpdate]);

  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <ScreenFrame corners="top" tabs={<FolderTabs active="settings" trashCount={trashCount} />}>
      <ScrollView contentContainerStyle={styles.content} style={styles.flex}>
        <SectionHeader title={ptBR.settingsTitle} />

        <View style={styles.card}>
          <Text style={styles.label}>{ptBR.displayNameLabel}</Text>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            onBlur={() => void persistDisplayName()}
            onSubmitEditing={() => void persistDisplayName()}
            placeholder={ptBR.displayNamePlaceholder}
            placeholderTextColor={theme.colors.inkLight}
            style={styles.input}
            maxLength={40}
            returnKeyType="done"
          />
        </View>

        <View style={styles.card}>
          <Pressable
            accessibilityLabel={ptBR.checkForUpdate}
            accessibilityRole="button"
            accessibilityState={{ busy: checkingUpdate, disabled: checkingUpdate }}
            disabled={checkingUpdate}
            onPress={() => void handleCheckUpdate()}
            style={({ pressed }) => [styles.updateRow, pressed && styles.pressed]}
          >
            <Text style={styles.updateRowLabel}>
              {checkingUpdate ? ptBR.checkingUpdate : ptBR.checkForUpdate}
            </Text>
            {checkingUpdate ? (
              <ActivityIndicator color={theme.colors.oliveTab} size="small" />
            ) : (
              <Text accessibilityElementsHidden style={styles.updateChevron}>
                ›
              </Text>
            )}
          </Pressable>

          {updateResult ? (
            <Text accessibilityLiveRegion="polite" style={styles.updateResult}>
              {updateResult}
            </Text>
          ) : null}
        </View>

        <Text style={styles.version}>{ptBR.versionLabel(version)}</Text>
      </ScrollView>

      <UpdateDialog
        manifest={updateManifest}
        visible={updateManifest !== null}
        onDismiss={() => setUpdateManifest(null)}
      />
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
  value: {
    ...theme.typography.body,
    color: theme.colors.ink,
  },
  input: {
    ...theme.typography.body,
    color: theme.colors.ink,
    backgroundColor: theme.colors.cream,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.tan,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    minHeight: 44,
  },
  version: {
    ...theme.typography.meta,
    color: theme.colors.inkLight,
    textAlign: 'center',
  },
  updateRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  updateRowLabel: {
    ...theme.typography.body,
    color: theme.colors.ink,
    flexShrink: 1,
  },
  updateChevron: {
    ...theme.typography.body,
    color: theme.colors.inkLight,
  },
  updateResult: {
    ...theme.typography.meta,
    color: theme.colors.inkLight,
  },
  pressed: {
    opacity: 0.7,
  },
});
