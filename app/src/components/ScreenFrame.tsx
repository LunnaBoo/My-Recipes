import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { theme } from '../theme';
import { IvyCorner, PanelEdge, Vignette } from './ornaments';

type ScreenFrameProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  panelStyle?: StyleProp<ViewStyle>;
  /** Folder tabs are only passed by the three tab-root screens. */
  tabs?: ReactNode;
  /** Top corners for list screens; diagonal for reading screens. */
  corners?: 'top' | 'diagonal' | 'none';
};

/**
 * Leafy-green desk with a parchment sheet floating on top.
 *
 * The panel's top and bottom edges are opaque leafy-green SVG overlays, which
 * give the sheet a slightly uneven paper edge without a texture asset. Ornaments
 * are static and sit outside the scrolling content.
 */
export function ScreenFrame({
  children,
  style,
  panelStyle,
  tabs,
  corners = 'diagonal',
}: ScreenFrameProps) {
  return (
    <View style={styles.root}>
      <Vignette />
      <SafeAreaView style={[styles.safe, style]} edges={['top', 'bottom', 'left', 'right']}>
        {tabs ? <View style={styles.tabs}>{tabs}</View> : null}

        <View style={[styles.panel, panelStyle]}>
          {corners !== 'none' ? (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <IvyCorner style={styles.ivyTopLeft} />
              {corners === 'top' ? (
                <IvyCorner flipX style={styles.ivyTopRight} />
              ) : (
                <IvyCorner flipX flipY style={styles.ivyBottomRight} />
              )}
            </View>
          ) : null}

          <View style={styles.content}>{children}</View>

          <PanelEdge edge="top" />
          <PanelEdge edge="bottom" />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.leafyGreen,
  },
  safe: {
    flex: 1,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
  },
  tabs: {
    zIndex: 4,
    height: 48,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  panel: {
    flex: 1,
    zIndex: 1,
    backgroundColor: theme.colors.parchment,
    borderRadius: theme.radii.lg,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: theme.colors.leafyDeep,
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  content: {
    flex: 1,
    paddingTop: theme.spacing.xs,
    zIndex: 2,
  },
  ivyTopLeft: {
    top: 10,
    left: 10,
  },
  ivyTopRight: {
    top: 10,
    right: 10,
  },
  ivyBottomRight: {
    bottom: 10,
    right: 10,
  },
});
