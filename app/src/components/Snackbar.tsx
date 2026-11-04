import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';

type SnackbarProps = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  duration?: number;
};

/** Slim leafy-green bar that rises from the bottom of the parchment. */
export function Snackbar({
  message,
  actionLabel,
  onAction,
  onDismiss,
  duration = 4000,
}: SnackbarProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => dismissRef.current(), duration);
    return () => clearTimeout(timer);
  }, [duration, opacity, translateY]);

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={[styles.bar, { opacity, transform: [{ translateY }] }]}
    >
      <Text style={styles.message}>{message}</Text>

      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            onAction();
            onDismiss();
          }}
          style={styles.action}
        >
          <Text style={styles.actionLabel}>{actionLabel}</Text>
        </Pressable>
      ) : (
        <View />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: theme.spacing.lg,
    right: theme.spacing.lg,
    bottom: theme.spacing.lg,
    zIndex: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.parchment,
    backgroundColor: theme.colors.leafyGreen,
    elevation: 6,
    shadowColor: theme.colors.leafyDeep,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  message: {
    ...theme.typography.bodySmall,
    flex: 1,
    color: theme.colors.cream,
  },
  action: {
    minHeight: 44,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    ...theme.typography.button,
    color: theme.colors.gold,
    textDecorationLine: 'underline',
  },
});
