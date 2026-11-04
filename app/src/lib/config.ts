import Constants from 'expo-constants';

export type ApiConfig = {
  apiBase: string;
  apiKey: string;
};

type RawExtra = {
  apiBase?: unknown;
  apiKey?: unknown;
};

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `Configuração ausente: expo.extra.${name}. Defina o valor em app.json.`,
    );
  }
  return value.trim();
}

/**
 * Reads the share API settings compiled into the app.
 *
 * Kept lazy on purpose: a missing value should fail when sharing/importing,
 * not while the app boots.
 */
export function getApiConfig(): ApiConfig {
  const extra = (Constants.expoConfig?.extra ?? {}) as RawExtra;
  const apiBase = requireString(extra.apiBase, 'apiBase').replace(/\/+$/, '');

  // The write key is injected at build time (EXPO_PUBLIC_APP_KEY) so it never
  // lives in the repository. `extra.apiKey` remains as a local fallback.
  const fromEnv = process.env.EXPO_PUBLIC_APP_KEY;
  const apiKey = requireString(fromEnv ?? extra.apiKey, 'apiKey');

  return { apiBase, apiKey };
}
