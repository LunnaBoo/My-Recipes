import { Tabs } from 'expo-router';

import { ptBR } from '../../i18n/pt-BR';

/**
 * Route group for the three folder tabs. The visual tab bar lives inside each
 * screen (ScreenFrame `tabs` slot), so the navigator's own bar is suppressed.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { display: 'none' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: ptBR.recipesTab }} />
      <Tabs.Screen name="trash" options={{ title: ptBR.trashTab }} />
      <Tabs.Screen name="settings" options={{ title: ptBR.settingsTab }} />
    </Tabs>
  );
}
