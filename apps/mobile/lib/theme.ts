// Leeloo Design System — matches Figma exactly
export const T = {
  colors: {
    navy: '#2D266C',
    purple: '#8375FA',
    peach: '#FFB59E',
    cream: '#FFF9F6',
    black: '#1A1A1A',
    white: '#FFFFFF',
    orange: '#F07040',
    error: '#DC2626',
    muted: '#9CA3AF',
    border: '#E8E4F0',
    card: '#F5F2FF',
  },
  gradient: {
    primary: ['#FFB59E', '#C4B0F8', '#8375FA'] as const,
    soft: ['#FFF9F6', '#F0EDFF'] as const,
  },
  fonts: {
    regular: 'Raleway_400Regular',
    semiBold: 'Raleway_600SemiBold',
    bold: 'Raleway_700Bold',
  },
  radius: {
    sm: 8,
    md: 14,
    lg: 20,
    full: 999,
  },
} as const;
