import { useFonts } from 'expo-font';

/**
 * Font keys match the family names used by the theme tokens.
 * All four files are static TTFs under the SIL Open Font License.
 */
export const appFonts = {
  'CormorantGaramond-Bold': require('../../assets/fonts/CormorantGaramond-Bold.ttf'),
  'SourceSerif4-Regular': require('../../assets/fonts/SourceSerif4-Regular.ttf'),
  'SourceSerif4-SemiBold': require('../../assets/fonts/SourceSerif4-SemiBold.ttf'),
  'SourceSerif4-Bold': require('../../assets/fonts/SourceSerif4-Bold.ttf'),
} as const;

export type AppFontsResult = {
  loaded: boolean;
  error: Error | null;
};

export function useAppFonts(): AppFontsResult {
  const [loaded, error] = useFonts(appFonts);
  return { loaded, error: error ?? null };
}
