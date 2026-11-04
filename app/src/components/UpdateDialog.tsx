import { useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  findNodeHandle,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ptBR } from '../i18n/pt-BR';
import { formatSize, type UpdateManifest } from '../lib/updateLogic';
import {
  downloadApk,
  installApk,
  openInstallPermissionSettings,
  UpdateError,
  type UpdateErrorCode,
} from '../lib/updater';
import { theme } from '../theme';
import { PanelEdge } from './ornaments';

type Phase = 'prompt' | 'downloading' | 'permission' | 'error';

type UpdateDialogProps = {
  manifest: UpdateManifest | null;
  visible: boolean;
  onDismiss: () => void;
};

function errorMessage(code: UpdateErrorCode): string {
  switch (code) {
    case 'offline':
      return ptBR.updateOffline;
    case 'corrupt':
      return ptBR.updateCorrupt;
    case 'server':
      return ptBR.updateServer;
    case 'permission':
      return ptBR.updatePermissionBody;
  }
}

/**
 * Parchment modal for the in-app update handoff.
 *
 * Flow: prompt → download with progress → system installer. If the installer
 * intent is rejected (usually the per-app "install unknown apps" permission),
 * the dialog offers a shortcut to the system setting and a retry that reuses
 * the already downloaded APK.
 */
export function UpdateDialog({ manifest, visible, onDismiss }: UpdateDialogProps) {
  const [phase, setPhase] = useState<Phase>('prompt');
  const [progress, setProgress] = useState(0);
  const [errorCode, setErrorCode] = useState<UpdateErrorCode>('server');
  const [downloadedUri, setDownloadedUri] = useState<string | null>(null);
  const panelRef = useRef<ComponentRef<typeof View>>(null);
  const dismissedRef = useRef(false);
  const busyRef = useRef(false);

  const isOpen = visible && manifest !== null;

  useEffect(() => {
    if (!isOpen) return;

    dismissedRef.current = false;
    busyRef.current = false;
    setPhase('prompt');
    setProgress(0);
    setDownloadedUri(null);
    setErrorCode('server');

    const timer = setTimeout(() => {
      const node = findNodeHandle(panelRef.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, 100);

    return () => clearTimeout(timer);
  }, [isOpen, manifest?.versionCode]);

  const dismiss = () => {
    dismissedRef.current = true;
    onDismiss();
  };

  const launchInstaller = async (uri: string) => {
    try {
      await installApk(uri);
      // The installer replaces this process once the user confirms; closing now
      // avoids a dialog stuck behind the installer if they cancel.
      dismiss();
    } catch (error) {
      if (dismissedRef.current) return;
      setErrorCode(error instanceof UpdateError ? error.code : 'permission');
      setPhase('permission');
    }
  };

  const startDownload = async () => {
    if (!manifest || busyRef.current) return;

    busyRef.current = true;
    setPhase('downloading');
    setProgress(0);
    setDownloadedUri(null);

    try {
      const uri = await downloadApk(manifest, (value) => setProgress(value));
      if (dismissedRef.current) return;
      setDownloadedUri(uri);
      await launchInstaller(uri);
    } catch (error) {
      if (dismissedRef.current) return;
      setErrorCode(error instanceof UpdateError ? error.code : 'server');
      setPhase('error');
    } finally {
      busyRef.current = false;
    }
  };

  const handleUpdate = () => {
    if (downloadedUri) {
      void launchInstaller(downloadedUri);
      return;
    }
    void startDownload();
  };

  const handleRetry = () => {
    setDownloadedUri(null);
    void startDownload();
  };

  const handleOpenSettings = async () => {
    try {
      await openInstallPermissionSettings();
    } catch (error) {
      console.warn('[update] could not open install settings:', error);
    }
  };

  const percent = Math.round(progress * 100);
  const progressWidth = `${percent}%` as `${number}%`;

  return (
    <Modal
      animationType="fade"
      onRequestClose={dismiss}
      statusBarTranslucent
      transparent
      visible={isOpen}
    >
      <View style={styles.root}>
        <Pressable
          accessible={false}
          importantForAccessibility="no"
          onPress={dismiss}
          style={styles.scrim}
        />

        <View
          ref={panelRef}
          accessibilityViewIsModal
          importantForAccessibility="yes"
          onAccessibilityEscape={dismiss}
          style={styles.panel}
        >
          <PanelEdge edge="top" />
          <PanelEdge edge="bottom" />

          <View style={styles.body}>
            {phase === 'prompt' ? (
              <>
                <Text accessibilityRole="header" style={styles.title}>
                  {ptBR.updateAvailableTitle}
                </Text>
                <Text style={styles.version}>{manifest?.versionName}</Text>

                {manifest?.notes ? (
                  <ScrollView style={styles.notesScroll}>
                    <Text style={styles.notes}>{manifest.notes}</Text>
                  </ScrollView>
                ) : null}

                {manifest?.size ? (
                  <Text style={styles.meta}>{ptBR.updateSize(formatSize(manifest.size))}</Text>
                ) : null}

                <View style={styles.actions}>
                  <Pressable
                    accessibilityLabel={ptBR.updateNow}
                    accessibilityRole="button"
                    onPress={handleUpdate}
                    style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
                  >
                    <Text style={styles.primaryLabel}>{ptBR.updateNow}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={ptBR.updateLater}
                    accessibilityRole="button"
                    onPress={dismiss}
                    style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
                  >
                    <Text style={styles.secondaryLabel}>{ptBR.updateLater}</Text>
                  </Pressable>
                </View>
              </>
            ) : null}

            {phase === 'downloading' ? (
              <>
                <Text accessibilityRole="header" style={styles.title}>
                  {ptBR.updateDownloadingTitle}
                </Text>
                <Text accessibilityLiveRegion="polite" style={styles.progressLabel}>
                  {ptBR.updateDownloading(percent)}
                </Text>
                <View
                  accessibilityLabel={ptBR.updateDownloading(percent)}
                  accessibilityRole="progressbar"
                  accessibilityValue={{ min: 0, max: 100, now: percent }}
                  style={styles.progressTrack}
                >
                  <View style={[styles.progressFill, { width: progressWidth }]} />
                </View>
                <ActivityIndicator color={theme.colors.oliveTab} style={styles.spinner} />
              </>
            ) : null}

            {phase === 'permission' ? (
              <>
                <Text accessibilityRole="header" style={styles.title}>
                  {ptBR.updatePermissionTitle}
                </Text>
                <Text style={styles.bodyText}>{ptBR.updatePermissionBody}</Text>

                <View style={styles.actions}>
                  <Pressable
                    accessibilityLabel={ptBR.updateOpenSettings}
                    accessibilityRole="button"
                    onPress={() => void handleOpenSettings()}
                    style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
                  >
                    <Text style={styles.primaryLabel}>{ptBR.updateOpenSettings}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={ptBR.retry}
                    accessibilityRole="button"
                    onPress={handleUpdate}
                    style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
                  >
                    <Text style={styles.secondaryLabel}>{ptBR.retry}</Text>
                  </Pressable>
                </View>
              </>
            ) : null}

            {phase === 'error' ? (
              <>
                <Text accessibilityRole="header" style={styles.title}>
                  {ptBR.updateFailedTitle}
                </Text>
                <Text accessibilityLiveRegion="polite" style={styles.bodyText}>
                  {errorMessage(errorCode)}
                </Text>

                <View style={styles.actions}>
                  <Pressable
                    accessibilityLabel={ptBR.retry}
                    accessibilityRole="button"
                    onPress={handleRetry}
                    style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
                  >
                    <Text style={styles.primaryLabel}>{ptBR.retry}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={ptBR.updateLater}
                    accessibilityRole="button"
                    onPress={dismiss}
                    style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
                  >
                    <Text style={styles.secondaryLabel}>{ptBR.updateLater}</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: theme.colors.leafyDeep,
    opacity: 0.72,
  },
  panel: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: theme.colors.parchment,
    borderRadius: theme.radii.lg,
    borderWidth: 1.5,
    borderColor: theme.colors.tan,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: theme.colors.leafyDeep,
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  body: {
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.xl,
  },
  title: {
    ...theme.typography.sectionTitle,
    color: theme.colors.ink,
    textAlign: 'center',
  },
  version: {
    ...theme.typography.recipeTitle,
    color: theme.colors.oliveTab,
    textAlign: 'center',
  },
  notesScroll: {
    maxHeight: 148,
  },
  notes: {
    ...theme.typography.bodySmall,
    color: theme.colors.ink,
  },
  meta: {
    ...theme.typography.meta,
    color: theme.colors.inkLight,
    textAlign: 'center',
  },
  bodyText: {
    ...theme.typography.bodySmall,
    color: theme.colors.ink,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  primary: {
    flex: 1,
    minHeight: 44,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    borderRadius: 22,
    backgroundColor: theme.colors.oliveTab,
  },
  primaryLabel: {
    ...theme.typography.button,
    color: theme.colors.cream,
    textTransform: 'uppercase',
  },
  secondary: {
    flex: 1,
    minHeight: 44,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: theme.colors.inkLight,
  },
  secondaryLabel: {
    ...theme.typography.button,
    color: theme.colors.ink,
    textTransform: 'uppercase',
  },
  pressed: {
    opacity: 0.72,
  },
  progressLabel: {
    ...theme.typography.body,
    color: theme.colors.ink,
    textAlign: 'center',
  },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: theme.colors.tan,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: theme.colors.oliveTab,
  },
  spinner: {
    marginTop: theme.spacing.xs,
  },
});
