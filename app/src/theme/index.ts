/**
 * Design tokens copied from DESIGN.md §1–§3.
 * Every colour, spacing step, radius and type size in the app comes from here.
 */

export const colors = {
  parchment: '#E8D9B8',
  cream: '#F0E6CF',
  ink: '#3A2A1A',
  inkLight: '#6B5344',
  sage: '#8A9A5B',
  sageLight: '#9CAB6E',
  olive: '#6B7A3A',
  oliveTab: '#4A5A28',
  mauve: '#8B6F8F',
  mauveTab: '#5F435F',
  tan: '#C4A87A',
  tanTab: '#7A5F3A',
  gold: '#D4A94A',
  leafyGreen: '#243320',
  leafyDeep: '#1A2616',
  navy: '#2F3B52',
  navyDark: '#202B40',
  maroon: '#6E2F3F',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 4,
  md: 8,
  lg: 16,
  tabTop: 12,
} as const;

export const fontFamilies = {
  display: 'CormorantGaramond-Bold',
  bodyRegular: 'SourceSerif4-Regular',
  bodySemiBold: 'SourceSerif4-SemiBold',
  bodyBold: 'SourceSerif4-Bold',
} as const;

export const typography = {
  sectionTitle: {
    fontFamily: fontFamilies.display,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: 3.96,
    textTransform: 'uppercase',
  },
  recipeTitle: {
    fontFamily: fontFamilies.display,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  listTitle: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    letterSpacing: 0,
  },
  body: {
    fontFamily: fontFamilies.bodyRegular,
    fontSize: 17,
    lineHeight: 26,
    fontWeight: '400',
    letterSpacing: 0,
  },
  bodySmall: {
    fontFamily: fontFamilies.bodyRegular,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
    letterSpacing: 0,
  },
  meta: {
    fontFamily: fontFamilies.bodySemiBold,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    letterSpacing: 0.52,
  },
  button: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    letterSpacing: 0.56,
  },
  tabLabel: {
    fontFamily: fontFamilies.display,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
} as const;

export const theme = {
  colors,
  spacing,
  radii,
  fontFamilies,
  typography,
} as const;

export type Theme = typeof theme;

/** Single light theme for v1 (DESIGN.md §8). */
export function useTheme(): Theme {
  return theme;
}
