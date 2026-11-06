import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ptBR } from '../i18n/pt-BR';
import { theme } from '../theme';

export type FolderTabKey = 'recipes' | 'mailbox' | 'settings';

type FolderTabsProps = {
  active: FolderTabKey;
  /** Unread letter count, shown on the Cartas tab when greater than zero. */
  mailboxCount?: number;
};

type TabDefinition = {
  key: FolderTabKey;
  label: string;
  href: '/' | '/mailbox' | '/settings';
  color: string;
};

const TABS: readonly TabDefinition[] = [
  { key: 'recipes', label: ptBR.recipesTab, href: '/', color: theme.colors.oliveTab },
  { key: 'mailbox', label: ptBR.mailboxTab, href: '/mailbox', color: theme.colors.mauveTab },
  { key: 'settings', label: ptBR.settingsTab, href: '/settings', color: theme.colors.tanTab },
];

/**
 * Compact, left-aligned folder tabs that sit on the top edge of the parchment
 * sheet. Each tab is only as wide as its label needs (with comfortable padding);
 * the remaining row space stays empty.
 *
 * The active tab is taller and fully opaque, with its bottom edge extending
 * past the tab row so it visually continues into the panel. Inactive tabs are
 * shorter, dimmed, and sit at the bottom of the row.
 */
export function FolderTabs({ active, mailboxCount = 0 }: FolderTabsProps) {
  const router = useRouter();

  return (
    <View accessibilityRole="tablist" style={styles.bar}>
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        const showBadge = tab.key === 'mailbox' && mailboxCount > 0;

        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={
              showBadge ? `${tab.label}, ${ptBR.mailboxCount(mailboxCount)}` : tab.label
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
                  <Text style={styles.badgeLabel}>
                    {mailboxCount > 99 ? '99+' : mailboxCount}
                  </Text>
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
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    minWidth: 80,
    height: 48,
    justifyContent: 'flex-end',
  },
  face: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderTopLeftRadius: theme.radii.tabTop,
    borderTopRightRadius: theme.radii.tabTop,
  },
  faceActive: {
    height: 54,
    marginBottom: -6,
    paddingTop: 12,
    zIndex: 2,
  },
  faceInactive: {
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
    top: 5,
    right: 5,
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
