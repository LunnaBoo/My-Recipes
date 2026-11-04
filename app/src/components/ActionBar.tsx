import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { theme } from '../theme';

export type ActionBarAction = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  accessibilityLabel?: string;
  disabled?: boolean;
};

type ActionBarProps = {
  actions: readonly ActionBarAction[];
};

/**
 * Sticky bottom bar on the parchment sheet. The shell consumes the device
 * safe-area inset around the panel, so the bar only needs breathing room above
 * the torn bottom edge.
 */
export function ActionBar({ actions }: ActionBarProps) {
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.6 && actions.length > 2;

  return (
    <View style={[styles.bar, stacked && styles.barStacked]}>
      <View pointerEvents="none" style={styles.topRule} />

      {actions.map((action) => {
        const variant = action.variant ?? 'secondary';

        return (
          <Pressable
            key={action.label}
            accessibilityRole="button"
            accessibilityLabel={action.accessibilityLabel ?? action.label}
            accessibilityState={{ disabled: action.disabled === true }}
            disabled={action.disabled}
            onPress={action.onPress}
            style={({ pressed }) => [
              styles.button,
              stacked && styles.buttonStacked,
              variant === 'primary' && styles.primary,
              variant === 'secondary' && styles.secondary,
              variant === 'danger' && styles.danger,
              pressed && styles.pressed,
              action.disabled && styles.disabled,
            ]}
          >
            <Text
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              numberOfLines={1}
              style={[
                styles.label,
                variant === 'primary' && styles.primaryLabel,
                variant === 'secondary' && styles.secondaryLabel,
                variant === 'danger' && styles.dangerLabel,
              ]}
            >
              {action.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
    backgroundColor: theme.colors.parchment,
  },
  barStacked: {
    flexDirection: 'column',
  },
  topRule: {
    position: 'absolute',
    top: 0,
    left: theme.spacing.lg,
    right: theme.spacing.lg,
    height: StyleSheet.hairlineWidth,
    opacity: 0.25,
    backgroundColor: theme.colors.inkLight,
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
  primary: {
    backgroundColor: theme.colors.oliveTab,
    borderColor: theme.colors.oliveTab,
  },
  secondary: {
    backgroundColor: theme.colors.parchment,
    borderColor: theme.colors.inkLight,
  },
  danger: {
    backgroundColor: theme.colors.parchment,
    borderColor: theme.colors.maroon,
  },
  label: {
    ...theme.typography.button,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  primaryLabel: {
    color: theme.colors.cream,
  },
  secondaryLabel: {
    color: theme.colors.ink,
  },
  dangerLabel: {
    color: theme.colors.maroon,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.4,
  },
});
