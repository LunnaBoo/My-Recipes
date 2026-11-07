import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { FolderTabs } from '../../components/FolderTabs';
import { ScreenFrame } from '../../components/ScreenFrame';
import { Seal } from '../../components/Seal';
import { SectionHeader } from '../../components/SectionHeader';
import { UpdateDialog } from '../../components/UpdateDialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { countUnread } from '../../db/mailboxRepository';
import { countTrashed, getProfile } from '../../db/repository';
import type { Profile } from '../../db/types';
import { ptBR } from '../../i18n/pt-BR';
import { BackupError, exportBackup, importBackup } from '../../lib/backupFile';
import { sealFromStored } from '../../lib/seal';
import type { UpdateManifest } from '../../lib/updateLogic';
import { checkForUpdate, recordUpdateCheck, UpdateError } from '../../lib/updater';
import { theme } from '../../theme';

/** Settings root inside the parchment shell; editing lands in its own lane. */
export default function SettingsScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [trashCount, setTrashCount] = useState(0);
  const [mailboxCount, setMailboxCount] = useState(0);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<string | null>(null);
  const [updateManifest, setUpdateManifest] = useState<UpdateManifest | null>(null);
  const [backupAction, setBackupAction] = useState<'export' | 'import' | null>(null);
  const [backupResult, setBackupResult] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<{ title: string; body: string } | null>(null);

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
        countUnread().catch((error: unknown) => {
          console.warn('[settings] unread count failed:', error);
          return 0;
        }),
      ])
        .then(([loadedProfile, trashed, unread]) => {
          if (cancelled) return;
          setProfile(loadedProfile);
          setTrashCount(trashed);
          setMailboxCount(unread);
        })
        .catch((error: unknown) => {
          console.warn('[settings] load failed:', error);
        });

      return () => {
        cancelled = true;
      };
    }, []),
  );

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
  const backupBusy = backupAction !== null;

  const handleExport = useCallback(async () => {
    if (backupAction !== null) return;

    setBackupAction('export');
    setBackupResult(null);

    try {
      const result = await exportBackup();
      setBackupResult(result.shared ? ptBR.exportSummary(result.count) : ptBR.exportEmpty);
    } catch (error) {
      setBackupResult(error instanceof BackupError ? error.message : ptBR.backupExportFailed);
    } finally {
      setBackupAction(null);
    }
  }, [backupAction]);

  const handleImport = useCallback(async () => {
    if (backupAction !== null) return;

    setBackupAction('import');
    setBackupResult(null);

    try {
      const result = await importBackup();
      if (!result) return;

      setBackupResult(ptBR.importSummary(result.inserted, result.existing));

      if (result.existing > 0 || result.missingFiles > 0) {
        const lines: string[] = [];

        if (result.existing > 0) {
          lines.push(
            result.inserted === 0
              ? ptBR.importNoNewRecipes(result.existing)
              : ptBR.importSummary(result.inserted, result.existing),
          );
        }
        if (result.missingFiles > 0) {
          lines.push(ptBR.importMissingFiles(result.missingFiles));
        }

        setImportNotice({ title: ptBR.importNoticeTitle, body: lines.join('\n\n') });
      }
    } catch (error) {
      setBackupResult(error instanceof BackupError ? error.message : ptBR.backupImportFailed);
    } finally {
      setBackupAction(null);
    }
  }, [backupAction]);

  const profileSeal = profile ? sealFromStored(profile.sealJson) : null;

  return (
    <ScreenFrame corners="top" tabs={<FolderTabs active="settings" mailboxCount={mailboxCount} />}>
      <ScrollView contentContainerStyle={styles.content} style={styles.flex}>
        <SectionHeader title={ptBR.settingsTitle} />

        <View style={styles.card}>
          <Pressable
            accessibilityLabel={ptBR.sealTitle}
            accessibilityRole="button"
            onPress={() => router.push('/seal')}
            style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
          >
            <Text style={styles.actionRowLabel}>{ptBR.sealTitle}</Text>
            <View style={styles.sealRow}>
              <Seal size={28} seal={profileSeal} />
              <Text accessibilityElementsHidden style={styles.chevron}>
                ›
              </Text>
            </View>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Pressable
            accessibilityLabel={ptBR.contactsTitle}
            accessibilityRole="button"
            onPress={() => router.push('/mailbox/contacts')}
            style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
          >
            <Text style={styles.actionRowLabel}>{ptBR.contactsTitle}</Text>
            <Text accessibilityElementsHidden style={styles.chevron}>
              ›
            </Text>
          </Pressable>

          <View pointerEvents="none" style={styles.rule} />

          <Pressable
            accessibilityLabel={ptBR.trashRow}
            accessibilityRole="button"
            onPress={() => router.push('/trash')}
            style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
          >
            <View style={styles.rowWithBadge}>
              <Text style={styles.actionRowLabel}>{ptBR.trashRow}</Text>
              {trashCount > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeLabel}>
                    {trashCount > 99 ? '99+' : trashCount}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text accessibilityElementsHidden style={styles.chevron}>
              ›
            </Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Pressable
            accessibilityLabel={ptBR.exportBackup}
            accessibilityRole="button"
            accessibilityState={{ busy: backupAction === 'export', disabled: backupBusy }}
            disabled={backupBusy}
            onPress={() => void handleExport()}
            style={({ pressed }) => [
              styles.actionRow,
              pressed && styles.pressed,
              backupBusy && styles.actionRowDisabled,
            ]}
          >
            <Text style={styles.actionRowLabel}>
              {backupAction === 'export' ? ptBR.exportingBackup : ptBR.exportBackup}
            </Text>
            {backupAction === 'export' ? (
              <ActivityIndicator color={theme.colors.oliveTab} size="small" />
            ) : (
              <Text accessibilityElementsHidden style={styles.chevron}>
                ›
              </Text>
            )}
          </Pressable>

          <View pointerEvents="none" style={styles.rule} />

          <Pressable
            accessibilityLabel={ptBR.importBackup}
            accessibilityRole="button"
            accessibilityState={{ busy: backupAction === 'import', disabled: backupBusy }}
            disabled={backupBusy}
            onPress={() => void handleImport()}
            style={({ pressed }) => [
              styles.actionRow,
              pressed && styles.pressed,
              backupBusy && styles.actionRowDisabled,
            ]}
          >
            <Text style={styles.actionRowLabel}>
              {backupAction === 'import' ? ptBR.importingBackup : ptBR.importBackup}
            </Text>
            {backupAction === 'import' ? (
              <ActivityIndicator color={theme.colors.oliveTab} size="small" />
            ) : (
              <Text accessibilityElementsHidden style={styles.chevron}>
                ›
              </Text>
            )}
          </Pressable>

          {backupResult ? (
            <Text accessibilityLiveRegion="polite" style={styles.updateResult}>
              {backupResult}
            </Text>
          ) : null}
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

      <ConfirmDialog
        body={importNotice?.body}
        confirmLabel={ptBR.understood}
        noticeOnly
        onConfirm={() => setImportNotice(null)}
        onDismiss={() => setImportNotice(null)}
        title={importNotice?.title ?? ptBR.importNoticeTitle}
        visible={importNotice !== null}
      />

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
  sealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  rowWithBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.maroon,
  },
  badgeLabel: {
    ...theme.typography.meta,
    color: theme.colors.cream,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 0,
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
  actionRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  actionRowDisabled: {
    opacity: 0.4,
  },
  actionRowLabel: {
    ...theme.typography.body,
    color: theme.colors.ink,
    flexShrink: 1,
  },
  chevron: {
    ...theme.typography.body,
    color: theme.colors.inkLight,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    opacity: 0.25,
    backgroundColor: theme.colors.inkLight,
  },
  pressed: {
    opacity: 0.7,
  },
});
