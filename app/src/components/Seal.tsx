import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { theme } from '../theme';

export type SealSigil = 'cat' | 'moon' | 'sun' | 'star' | 'mushroom' | 'owl';

type SealProps = {
  size?: number;
  sigil?: SealSigil;
  style?: StyleProp<ViewStyle>;
};

function SigilMark({ sigil }: { sigil: SealSigil }) {
  const stroke = theme.colors.cream;

  switch (sigil) {
    case 'cat':
      return (
        <>
          <Path
            d="M14,38 L14,28 C14,20 20,14 28,14 L34,10 L34,20 C38,22 40,26 40,30 C40,38 32,42 24,42 C20,42 16,40 14,38 Z"
            fill="none"
            stroke={stroke}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Circle cx={20} cy={28} r={2.2} fill={stroke} />
          <Circle cx={32} cy={28} r={2.2} fill={stroke} />
          <Path
            d="M24,32 Q26,35 24,38 Q22,35 24,32"
            fill="none"
            stroke={stroke}
            strokeWidth={1.8}
            strokeLinecap="round"
          />
          <Path
            d="M18,20 L22,24 M30,24 L34,20"
            fill="none"
            stroke={stroke}
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        </>
      );
    case 'moon':
      return (
        <Path
          d="M28,8 C20,8 14,16 14,26 C14,36 20,44 28,44 C32,44 36,42 38,40 C34,42 28,38 28,26 C28,14 34,10 38,12 C36,10 32,8 28,8 Z"
          fill="none"
          stroke={stroke}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'sun':
      return (
        <>
          <Circle cx={24} cy={24} r={10} fill="none" stroke={stroke} strokeWidth={2.2} />
          <Path
            d="M24,6 L24,10 M24,38 L24,42 M6,24 L10,24 M38,24 L42,24 M12,12 L15,15 M33,33 L36,36 M12,36 L15,33 M33,15 L36,12"
            fill="none"
            stroke={stroke}
            strokeWidth={2.2}
            strokeLinecap="round"
          />
        </>
      );
    case 'mushroom':
      return (
        <>
          <Path
            d="M24,40 L24,26 M16,40 L32,40"
            fill="none"
            stroke={stroke}
            strokeWidth={2.2}
            strokeLinecap="round"
          />
          <Path
            d="M8,26 C8,16 16,8 24,8 C32,8 40,16 40,26 C40,28 38,30 36,30 L12,30 C10,30 8,28 8,26 Z"
            fill="none"
            stroke={stroke}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Circle cx={16} cy={20} r={2} fill={stroke} />
          <Circle cx={30} cy={18} r={1.6} fill={stroke} />
          <Circle cx={36} cy={24} r={1.3} fill={stroke} />
        </>
      );
    case 'owl':
      return (
        <>
          <Path
            d="M16,18 Q24,10 32,18"
            fill="none"
            stroke={stroke}
            strokeWidth={2.2}
            strokeLinecap="round"
          />
          <Path
            d="M13,14 L15,20 M35,20 L37,14"
            fill="none"
            stroke={stroke}
            strokeWidth={2.2}
            strokeLinecap="round"
          />
          <Circle cx={19} cy={24} r={5} fill="none" stroke={stroke} strokeWidth={2} />
          <Circle cx={29} cy={24} r={5} fill="none" stroke={stroke} strokeWidth={2} />
          <Circle cx={19} cy={24} r={1.5} fill={stroke} />
          <Circle cx={29} cy={24} r={1.5} fill={stroke} />
          <Path d="M24,29 L21,34 L27,34 Z" fill={stroke} />
        </>
      );
    case 'star':
    default:
      return (
        <Path
          d="M24,6 L28,18 L40,18 L30,26 L34,40 L24,32 L14,40 L18,26 L8,18 L20,18 Z"
          fill="none"
          stroke={stroke}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
  }
}

/**
 * Plain wax-seal disc: one navy fill, one thin rim, cream line-art sigil.
 * Decorative only; the sender name is always shown as text next to it.
 */
export function Seal({ size = 30, sigil = 'star', style }: SealProps) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={style}
    >
      <Svg width={size} height={size} viewBox="0 0 48 48">
        <Circle
          cx={24}
          cy={24}
          r={23}
          fill={theme.colors.navy}
          stroke={theme.colors.navyDark}
          strokeWidth={1.5}
        />
        <SigilMark sigil={sigil} />
      </Svg>
    </View>
  );
}
