import { useEffect, useRef, type ComponentRef } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { ptBR } from '../i18n/pt-BR';
import { theme } from '../theme';

type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onDismiss: () => void;
  destructive?: boolean;
  /** Single "Entendi" button for validation and notice messages. */
  noticeOnly?: boolean;
};

/**
 * Centered parchment confirmation dialog.
 *
 * Pure presentation: the caller owns the copy and the resulting action. The
 * scrim and Android back button both dismiss; in notice-only mode the single
 * button dismisses too.
 */
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onDismiss,
  destructive = false,
  noticeOnly = false,
}: ConfirmDialogProps) {
  const panelRef = useRef<ComponentRef<typeof View>>(null);
  const { fontScale } = useWindowDimensions();
  const stacked = !noticeOnly && fontScale >= 1.4;

  useEffect(() => {
    if (!visible) return;

    const timer = setTimeout(() => {
      const node = findNodeHandle(panelRef.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, 100);

    return () => clearTimeout(timer);
  }, [visible]);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onDismiss}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.root}>
        <Pressable
          accessibilityLabel={ptBR.close}
          accessibilityRole="button"
          onPress={onDismiss}
          style={styles.scrim}
        />

        <View
          ref={panelRef}
          accessibilityViewIsModal
          importantForAccessibility="yes"
          onAccessibilityEscape={onDismiss}
          style={styles.panel}
        >
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>

          {body ? <Text style={styles.body}>{body}</Text> : null}

          <View style={[styles.actions, stacked && styles.actionsStacked]}>
            {noticeOnly ? (
              <Pressable
                accessibilityLabel={confirmLabel}
                accessibilityRole="button"
                onPress={onDismiss}
                style={({ pressed }) => [
                  styles.button,
                  styles.primary,
                  styles.noticeButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.buttonLabel, styles.primaryLabel]}>{confirmLabel}</Text>
              </Pressable>
            ) : (
              <>
                <Pressable
                  accessibilityLabel={cancelLabel ?? ptBR.cancel}
                  accessibilityRole="button"
                  onPress={onDismiss}
                  style={({ pressed }) => [
                    styles.button,
                    styles.secondary,
                    stacked && styles.buttonStacked,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.buttonLabel, styles.secondaryLabel]}>
                    {cancelLabel ?? ptBR.cancel}
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityLabel={confirmLabel}
                  accessibilityRole="button"
                  onPress={onConfirm}
                  style={({ pressed }) => [
                    styles.button,
                    destructive ? styles.destructive : styles.primary,
                    stacked && styles.buttonStacked,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.buttonLabel, styles.primaryLabel]}>{confirmLabel}</Text>
                </Pressable>
              </>
            )}
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
    opacity: 0.55,
  },
  panel: {
    width: '100%',
    maxWidth: 340,
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.xl,
    backgroundColor: theme.colors.parchment,
    borderWidth: 1.5,
    borderColor: theme.colors.tan,
    borderTopLeftRadius: theme.radii.lg,
    borderTopRightRadius: theme.radii.tabTop,
    borderBottomLeftRadius: theme.radii.tabTop,
    borderBottomRightRadius: theme.radii.lg,
    elevation: 8,
    shadowColor: theme.colors.leafyDeep,
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  title: {
    ...theme.typography.recipeTitle,
    color: theme.colors.ink,
    textAlign: 'center',
  },
  body: {
    ...theme.typography.bodySmall,
    color: theme.colors.ink,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  actionsStacked: {
    flexDirection: 'column',
  },
  button: {
    flex: 1,
    minHeight: 48,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: 24,
    borderWidth: 1.5,
  },
  buttonStacked: {
    flex: 0,
    alignSelf: 'stretch',
  },
  noticeButton: {
    flex: 0,
    alignSelf: 'stretch',
  },
  primary: {
    backgroundColor: theme.colors.oliveTab,
    borderColor: theme.colors.oliveTab,
  },
  secondary: {
    backgroundColor: theme.colors.parchment,
    borderColor: theme.colors.inkLight,
  },
  destructive: {
    backgroundColor: theme.colors.maroon,
    borderColor: theme.colors.maroon,
  },
  buttonLabel: {
    ...theme.typography.button,
    textAlign: 'center',
  },
  primaryLabel: {
    color: theme.colors.cream,
  },
  secondaryLabel: {
    color: theme.colors.ink,
  },
  pressed: {
    opacity: 0.72,
  },
});
