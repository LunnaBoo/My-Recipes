import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { theme } from '../theme';
import { Flourish } from './ornaments';

type SectionHeaderProps = {
  title: string;
  style?: StyleProp<ViewStyle>;
};

/** Centered uppercase Cormorant title with a leaf-and-gold flourish rule. */
export function SectionHeader({ title, style }: SectionHeaderProps) {
  return (
    <View style={[styles.row, style]}>
      <Flourish />
      <Text style={styles.title}>{title}</Text>
      <Flourish mirrored />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginVertical: theme.spacing.sm,
  },
  title: {
    ...theme.typography.sectionTitle,
    color: theme.colors.ink,
    textAlign: 'center',
    flexShrink: 1,
  },
});
