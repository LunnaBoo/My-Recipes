import { StyleSheet, TextInput, View } from 'react-native';

import { ptBR } from '../i18n/pt-BR';
import { theme } from '../theme';
import { SearchGlyph } from './ornaments';

type SearchFieldProps = {
  value: string;
  onChangeText: (value: string) => void;
};

/** Cream search field with a leaf/search affordance. Debouncing lives in the screen. */
export function SearchField({ value, onChangeText }: SearchFieldProps) {
  return (
    <View style={styles.field}>
      <SearchGlyph />
      <TextInput
        accessibilityLabel={ptBR.searchPlaceholder}
        autoCorrect={false}
        onChangeText={onChangeText}
        placeholder={ptBR.searchPlaceholder}
        placeholderTextColor={theme.colors.inkLight}
        returnKeyType="search"
        style={styles.input}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.cream,
    borderWidth: 1.5,
    borderColor: theme.colors.tan,
    borderRadius: 10,
  },
  input: {
    ...theme.typography.bodySmall,
    flex: 1,
    color: theme.colors.ink,
    paddingVertical: theme.spacing.sm,
  },
});
