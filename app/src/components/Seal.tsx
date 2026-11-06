import {
  Image,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import type { ImageSeal, LegacySigilId, Seal as SealValue, SigilId, StampId } from '../lib/seal';
import { isStampId } from '../lib/seal';
import { theme } from '../theme';

const STAMP_IMAGES: Record<StampId, ImageSourcePropType> = {
  bee: require('../../assets/seals/bee.webp'),
  cat: require('../../assets/seals/cat.webp'),
  leaf: require('../../assets/seals/leaf.webp'),
  moon: require('../../assets/seals/moon.webp'),
  mushroom: require('../../assets/seals/mushroom.webp'),
  sea: require('../../assets/seals/sea.webp'),
};

type SealProps = {
  size?: number;
  sigil?: SigilId;
  /** A parsed sender seal; takes precedence over the `sigil` fallback. */
  seal?: SealValue | null;
  style?: StyleProp<ViewStyle>;
};

/** Bundled photographic wax stamp: irregular silhouette, no disc or rim. */
function StampMark({ id, size }: { id: StampId; size: number }) {
  return (
    <Image
      accessible={false}
      resizeMode="contain"
      source={STAMP_IMAGES[id]}
      style={{ width: size, height: size }}
    />
  );
}

function SigilMark({ sigil }: { sigil: LegacySigilId }) {
  const stroke = theme.colors.cream;

  switch (sigil) {
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
 * Custom seal: the photo is clipped to a circle and the thin wax rim is drawn
 * on top, so the rim stays visible even on a light or busy photo.
 */
function ImageSealMark({ seal, size }: { seal: ImageSeal; size: number }) {
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
          backgroundColor: theme.colors.navy,
        }}
      >
        <Image
          accessible={false}
          resizeMode="cover"
          source={{ uri: `data:${seal.mime};base64,${seal.data}` }}
          style={{ width: size, height: size }}
        />
      </View>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Svg width={size} height={size} viewBox="0 0 48 48">
          <Circle
            cx={24}
            cy={24}
            r={23}
            fill="none"
            stroke={theme.colors.navyDark}
            strokeWidth={1.5}
          />
        </Svg>
      </View>
    </View>
  );
}

/**
 * Sender seal. Photo seals keep the circular wax frame; bundled photo stamps
 * render their own irregular silhouette; legacy sun/star/owl ids keep the old
 * navy disc line-art so stored recipes never change appearance.
 */
export function Seal({ size = 30, sigil = 'cat', seal, style }: SealProps) {
  const image = seal?.kind === 'image' ? seal : null;
  const chosenSigil = seal?.kind === 'sigil' ? seal.id : sigil;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={style}
    >
      {image ? (
        <ImageSealMark seal={image} size={size} />
      ) : isStampId(chosenSigil) ? (
        <StampMark id={chosenSigil} size={size} />
      ) : (
        <Svg width={size} height={size} viewBox="0 0 48 48">
          <Circle
            cx={24}
            cy={24}
            r={23}
            fill={theme.colors.navy}
            stroke={theme.colors.navyDark}
            strokeWidth={1.5}
          />
          <SigilMark sigil={chosenSigil} />
        </Svg>
      )}
    </View>
  );
}
