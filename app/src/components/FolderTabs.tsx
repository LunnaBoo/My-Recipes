import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ptBR } from '../i18n/pt-BR';
import { theme } from '../theme';

export type FolderTabKey = 'recipes' | 'trash' | 'settings';

type FolderTabsProps = {
  active: FolderTabKey;
  /** Only shown on the Lixeira tab, and only when greater than zero. */
  trashCount?: number;
};

type TabDefinition = {
  key: FolderTabKey;
  label: string;
  href: '/' | '/trash' | '/settings';
  color: string;
};

const TABS: readonly TabDefinition[] = [
  { key: 'recipes', label: ptBR.recipesTab, href: '/', color: theme.colors.oliveTab },
  { key: 'trash', label: ptBR.trashTab, href: '/trash', color: theme.colors.mauveTab },
  { key: 'settings', label: ptBR.settingsTab, href: '/settings', color: theme.colors.tanTab },
];

/**
 * Folder-style tabs that sit on the top edge of the parchment sheet.
 *
 * The active tab is a taller, opaque face whose bottom extends 8dp past the
 * tab row so it visually continues into the panel. Inactive tabs are shorter,
 * dimmed, and end where the parchment begins.
 */
export function FolderTabs({ active, trashCount = 0 }: FolderTabsProps) {
  const router = useRouter();

  return (
    <View accessibilityRole="tablist" style={styles.bar}>
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        const showBadge = tab.key === 'trash' && trashCount > 0;

        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={
              showBadge ? `${tab.label}, ${ptBR.trashCount(trashCount)}` : tab.label
            }
            onPress={() => {
              if (!isActive) router.navigate(tab.href);
            }}
            style={styles.tabHit}
          >
            <View
              style={[
                styles.face,
                isActive ? styles.faceActive : styles.faceInactive,
                { backgroundColor: tab.color },
              ]}
            >
              <Text
                adjustsFontSizeToFit
                maxFontSizeMultiplier={1.3}
                minimumFontScale={0.65}
                numberOfLines={1}
                style={styles.label}
              >
                {tab.label}
              </Text>

              {showBadge ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeLabel}>{trashCount > 99 ? '99+' : trashCount}</Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  tabHit: {
    flex: 1,
    minWidth: 80,
    height: 48,
    minHeight: 48,
  },
  face: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderTopLeftRadius: theme.radii.tabTop,
    borderTopRightRadius: theme.radii.tabTop,
  },
  faceActive: {
    height: 56,
    paddingTop: theme.spacing.sm,
    zIndex: 2,
  },
  faceInactive: {
    top: 10,
    height: 38,
    opacity: 0.72,
  },
  label: {
    ...theme.typography.tabLabel,
    color: theme.colors.cream,
    textAlign: 'center',
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.maroon,
  },
  badgeLabel: {
    ...theme.typography.meta,
    color: theme.colors.cream,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 0,
  },
});
