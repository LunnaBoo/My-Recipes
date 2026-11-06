import { useEffect, useRef, type ComponentRef } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ptBR } from '../i18n/pt-BR';
import { theme } from '../theme';

export type ActionSheetItem = {
  label: string;
  onPress: () => void;
  tone?: 'default' | 'destructive';
  disabled?: boolean;
};

type ActionSheetProps = {
  visible: boolean;
  title?: string;
  subtitle?: string;
  items: readonly ActionSheetItem[];
  onDismiss: () => void;
};

/**
 * Parchment bottom sheet for context actions.
 *
 * Pure presentation: the caller owns the items and every action. The sheet only
 * renders rows and the scrim. It is dismissed by tapping outside or with the
 * system back gesture — there is no cancel row. Items scroll when the type scale
 * or the number of rows makes the panel taller than the screen.
 */
export function ActionSheet({
  visible,
  title,
  subtitle,
  items,
  onDismiss,
}: ActionSheetProps) {
  const insets = useSafeAreaInsets();
  const panelRef = useRef<ComponentRef<typeof View>>(null);

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
          style={[styles.panel, { paddingBottom: Math.max(insets.bottom, theme.spacing.lg) }]}
        >
          {title ? (
            <>
              <Text accessibilityRole="header" style={styles.title}>
                {title}
              </Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
              <View pointerEvents="none" style={styles.titleRule} />
            </>
          ) : null}

          <ScrollView
            bounces={false}
            contentContainerStyle={styles.itemsContent}
            showsVerticalScrollIndicator={false}
            style={styles.itemsScroll}
          >
            {items.map((item, index) => (
              <View key={`${item.label}-${index}`}>
                {index > 0 ? <View pointerEvents="none" style={styles.divider} /> : null}

                <Pressable
                  accessibilityLabel={item.label}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: item.disabled === true }}
                  disabled={item.disabled}
                  onPress={item.onPress}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && styles.rowPressed,
                    item.disabled && styles.rowDisabled,
                  ]}
                >
                  <Text
                    style={[
                      styles.rowLabel,
                      item.tone === 'destructive' && styles.rowLabelDestructive,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
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
    maxHeight: '88%',
    paddingTop: theme.spacing.sm,
    backgroundColor: theme.colors.parchment,
    borderTopLeftRadius: theme.radii.lg,
    borderTopRightRadius: theme.radii.lg,
    borderTopWidth: 1,
    borderColor: theme.colors.inkLight,
    elevation: 12,
    shadowColor: theme.colors.leafyDeep,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
  },
  title: {
    ...theme.typography.recipeTitle,
    color: theme.colors.ink,
    textAlign: 'center',
    paddingHorizontal: theme.spacing.xl,
  },
  subtitle: {
    ...theme.typography.bodySmall,
    color: theme.colors.inkLight,
    textAlign: 'center',
    paddingHorizontal: theme.spacing.xl,
    marginTop: theme.spacing.xs,
  },
  titleRule: {
    height: StyleSheet.hairlineWidth,
    opacity: 0.25,
    backgroundColor: theme.colors.inkLight,
    marginTop: theme.spacing.md,
    marginHorizontal: theme.spacing.xl,
  },
  itemsScroll: {
    flexGrow: 0,
    flexShrink: 1,
    marginTop: theme.spacing.xs,
  },
  itemsContent: {
    paddingHorizontal: theme.spacing.sm,
  },
  row: {
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radii.md,
  },
  rowPressed: {
    backgroundColor: theme.colors.sageLight,
  },
  rowDisabled: {
    opacity: 0.4,
  },
  rowLabel: {
    ...theme.typography.listTitle,
    color: theme.colors.ink,
  },
  rowLabelDestructive: {
    color: theme.colors.maroon,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.inkLight,
    opacity: 0.25,
    marginHorizontal: theme.spacing.lg,
  },
});
