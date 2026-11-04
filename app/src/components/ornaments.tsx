import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { theme } from '../theme';

/**
 * Static SVG ornaments shared by the shell and screens.
 *
 * All paths come from `design/mockup.html` so the app and the visual reference
 * stay in sync. These components never subscribe to state, which keeps them out
 * of FlatList scroll work.
 */

type IvyCornerProps = {
  flipX?: boolean;
  flipY?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function IvyCorner({ flipX = false, flipY = false, style }: IvyCornerProps) {
  const transform: ({ scaleX: number } | { scaleY: number })[] = [];
  if (flipX) transform.push({ scaleX: -1 });
  if (flipY) transform.push({ scaleY: -1 });

  return (
    <View pointerEvents="none" style={[styles.ivy, style]}>
      <View style={[styles.flip, transform.length > 0 ? { transform } : null]}>
        <Svg width="100%" height="100%" viewBox="0 0 80 80">
          <Path
            d="M2,78 Q8,55 22,42 Q12,44 4,52 M22,42 Q30,22 48,12 Q36,16 28,26 M48,12 Q55,6 66,2"
            fill="none"
            stroke={theme.colors.ink}
            strokeWidth={2}
            strokeLinecap="round"
          />
          <Ellipse
            cx={55}
            cy={18}
            rx={5}
            ry={8}
            fill={theme.colors.sage}
            transform="rotate(-25 55 18)"
          />
          <Ellipse
            cx={24}
            cy={46}
            rx={6}
            ry={9}
            fill={theme.colors.sage}
            transform="rotate(-15 24 46)"
          />
          <Circle cx={68} cy={8} r={2.5} fill={theme.colors.gold} />
          <Circle cx={72} cy={12} r={2} fill={theme.colors.maroon} />
          <Circle cx={14} cy={54} r={2} fill={theme.colors.gold} />
        </Svg>
      </View>
    </View>
  );
}

type FlourishProps = {
  mirrored?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Flourish({ mirrored = false, style }: FlourishProps) {
  return (
    <View pointerEvents="none" style={[styles.flourish, style]}>
      <View style={[styles.flip, mirrored && styles.flipX]}>
        <Svg width="100%" height="100%" viewBox="0 0 40 14">
          <Path
            d="M38,7 Q28,2 20,7 Q12,12 2,7"
            fill="none"
            stroke={theme.colors.inkLight}
            strokeWidth={1}
          />
          <Circle cx={4} cy={7} r={2} fill={theme.colors.gold} />
          <Ellipse
            cx={14}
            cy={9}
            rx={4}
            ry={3}
            fill={theme.colors.sage}
            transform="rotate(-15 14 9)"
          />
        </Svg>
      </View>
    </View>
  );
}

type SparkleProps = {
  size?: number;
};

export function Sparkle({ size = 18 }: SparkleProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12,2 L13.8,9.2 L21,12 L13.8,14.8 L12,22 L10.2,14.8 L3,12 L10.2,9.2 Z"
        fill={theme.colors.gold}
        stroke={theme.colors.ink}
        strokeWidth={1.2}
      />
    </Svg>
  );
}

type IvyWreathProps = {
  size?: number;
};

export function IvyWreath({ size = 120 }: IvyWreathProps) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <Svg width={size} height={size} viewBox="0 0 120 120">
        <Path
          d="M32,98 C10,76 8,40 30,20"
          fill="none"
          stroke={theme.colors.olive}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <Path
          d="M88,98 C110,76 112,40 90,20"
          fill="none"
          stroke={theme.colors.olive}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <Ellipse cx={19} cy={80} rx={5} ry={9} fill={theme.colors.sage} transform="rotate(-45 19 80)" />
        <Ellipse cx={14} cy={61} rx={5} ry={9} fill={theme.colors.sage} transform="rotate(-20 14 61)" />
        <Ellipse cx={18} cy={42} rx={5} ry={9} fill={theme.colors.sage} transform="rotate(5 18 42)" />
        <Ellipse cx={28} cy={27} rx={5} ry={8} fill={theme.colors.sage} transform="rotate(35 28 27)" />
        <Ellipse cx={101} cy={80} rx={5} ry={9} fill={theme.colors.sage} transform="rotate(45 101 80)" />
        <Ellipse cx={106} cy={61} rx={5} ry={9} fill={theme.colors.sage} transform="rotate(20 106 61)" />
        <Ellipse cx={102} cy={42} rx={5} ry={9} fill={theme.colors.sage} transform="rotate(-5 102 42)" />
        <Ellipse cx={92} cy={27} rx={5} ry={8} fill={theme.colors.sage} transform="rotate(-35 92 27)" />
        <Circle cx={26} cy={100} r={2.5} fill={theme.colors.gold} />
        <Circle cx={94} cy={100} r={2.5} fill={theme.colors.gold} />
        <Circle cx={30} cy={14} r={2} fill={theme.colors.maroon} />
        <Circle cx={90} cy={14} r={2} fill={theme.colors.maroon} />
      </Svg>
    </View>
  );
}

type SearchGlyphProps = {
  size?: number;
};

export function SearchGlyph({ size = 18 }: SearchGlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" pointerEvents="none">
      <Circle
        cx={7.5}
        cy={7.5}
        r={5.5}
        fill="none"
        stroke={theme.colors.inkLight}
        strokeWidth={1.6}
      />
      <Path
        d="M11.5,11.5 L16,16"
        stroke={theme.colors.inkLight}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <Ellipse
        cx={13}
        cy={3.6}
        rx={2.6}
        ry={1.4}
        fill={theme.colors.sage}
        transform="rotate(-35 13 3.6)"
      />
    </Svg>
  );
}

type PanelEdgeProps = {
  edge: 'top' | 'bottom';
};

/** Uneven parchment edge drawn as an opaque leafy-green overlay. */
export function PanelEdge({ edge }: PanelEdgeProps) {
  const isTop = edge === 'top';

  return (
    <Svg
      pointerEvents="none"
      preserveAspectRatio="none"
      style={[styles.edge, isTop ? styles.edgeTop : styles.edgeBottom]}
      width="100%"
      height={12}
      viewBox="0 0 360 12"
    >
      <Path
        d={
          isTop
            ? 'M0,0 L360,0 L360,8 C330,1 300,13 270,7 C240,1 210,13 180,7 C150,1 120,13 90,7 C60,1 30,13 0,8 Z'
            : 'M0,12 L360,12 L360,4 C330,11 300,0 270,6 C240,12 210,0 180,6 C150,12 120,0 90,6 C60,12 30,0 0,4 Z'
        }
        fill={isTop ? theme.colors.leafyGreen : theme.colors.leafyDeep}
      />
    </Svg>
  );
}

/** Subtle radial vignette behind the parchment panel. */
export function Vignette() {
  return (
    <Svg
      pointerEvents="none"
      style={styles.vignette}
      width="100%"
      height="100%"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <Defs>
        <RadialGradient id="leafy-vignette" cx="50" cy="38" r="80" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={theme.colors.leafyGreen} stopOpacity={0} />
          <Stop offset="0.66" stopColor={theme.colors.leafyGreen} stopOpacity={0.12} />
          <Stop offset="1" stopColor={theme.colors.leafyDeep} stopOpacity={0.65} />
        </RadialGradient>
      </Defs>
      <Rect width="100" height="100" fill="url(#leafy-vignette)" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  ivy: {
    position: 'absolute',
    width: 76,
    height: 76,
    opacity: 0.7,
  },
  flourish: {
    width: 38,
    height: 14,
    opacity: 0.7,
    flexShrink: 0,
  },
  flip: {
    width: '100%',
    height: '100%',
  },
  flipX: {
    transform: [{ scaleX: -1 }],
  },
  edge: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 3,
  },
  edgeTop: {
    top: 0,
  },
  edgeBottom: {
    bottom: 0,
  },
  vignette: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 0,
  },
});
