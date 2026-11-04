import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ptBR } from '../i18n/pt-BR';
import { theme } from '../theme';

type FilterRowProps = {
  pinnedOnly: boolean;
  onChange: (pinnedOnly: boolean) => void;
};

/** Two-segment control: Todas / Fixadas. Active segment is olive with cream text. */
export function FilterRow({ pinnedOnly, onChange }: FilterRowProps) {
  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: !pinnedOnly }}
        onPress={() => onChange(false)}
        style={[styles.segment, !pinnedOnly && styles.segmentActive]}
      >
        <Text style={[styles.label, !pinnedOnly && styles.labelActive]}>{ptBR.filterAll}</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: pinnedOnly }}
        onPress={() => onChange(true)}
        style={[styles.segment, pinnedOnly && styles.segmentActive]}
      >
        <Text style={[styles.label, pinnedOnly && styles.labelActive]}>{ptBR.filterPinned}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    padding: 2,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: theme.colors.tan,
    backgroundColor: theme.colors.cream,
    gap: 2,
  },
  segment: {
    minHeight: 44,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    borderRadius: 20,
  },
  segmentActive: {
    backgroundColor: theme.colors.oliveTab,
  },
  label: {
    ...theme.typography.button,
    color: theme.colors.inkLight,
  },
  labelActive: {
    color: theme.colors.cream,
  },
});
