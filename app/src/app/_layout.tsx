import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { purgeExpired } from '../db/repository';
import { useAppFonts } from '../fonts/useAppFonts';
import { theme } from '../theme';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { loaded, error } = useAppFonts();

  useEffect(() => {
    if (loaded || error) {
      void SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  useEffect(() => {
    if (error) {
      console.warn('[fonts] falling back to system fonts:', error.message);
    }
  }, [error]);

  useEffect(() => {
    void purgeExpired(30).catch((purgeError: unknown) => {
      console.warn('[trash] purge failed:', purgeError);
    });
  }, []);

  if (!loaded && !error) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.leafyGreen },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="recipe/[id]" />
        <Stack.Screen name="r/[id]" />
        <Stack.Screen name="edit/[id]" />
        <Stack.Screen name="import" />
        <Stack.Screen name="seal" />
      </Stack>
    </SafeAreaProvider>
  );
}
