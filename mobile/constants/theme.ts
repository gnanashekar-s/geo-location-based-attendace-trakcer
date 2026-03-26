// ─── Design System — Linear-inspired dark theme ────────────────────────────

export const Colors = {
  // Backgrounds
  bg: '#09090B',          // zinc-950 — main background
  card: '#18181B',        // zinc-900 — cards
  card2: '#27272A',       // zinc-800 — elevated / inputs
  border: 'rgba(255,255,255,0.06)',
  borderStrong: 'rgba(255,255,255,0.12)',

  // Brand — indigo
  primary: '#6366F1',
  primaryDark: '#4F46E5',
  primaryBg: 'rgba(99,102,241,0.10)',
  primaryBgHover: 'rgba(99,102,241,0.16)',

  // Semantic
  success: '#22C55E',
  successBg: 'rgba(34,197,94,0.10)',
  warning: '#F59E0B',
  warningBg: 'rgba(245,158,11,0.10)',
  danger: '#EF4444',
  dangerBg: 'rgba(239,68,68,0.10)',
  info: '#3B82F6',
  infoBg: 'rgba(59,130,246,0.10)',

  // Text
  text: '#FAFAFA',        // zinc-50
  textSub: '#A1A1AA',     // zinc-400
  textMuted: '#71717A',   // zinc-500
};

// Single gradient — only for primary CTA buttons
export const Gradients = {
  primary: ['#6366F1', '#8B5CF6'] as const,
  success: ['#16A34A', '#22C55E'] as const,
};

export const Typography = {
  display: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.5, lineHeight: 34, color: Colors.text },
  h1:      { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3, lineHeight: 28, color: Colors.text },
  h2:      { fontSize: 18, fontWeight: '600' as const, letterSpacing: -0.2, lineHeight: 24, color: Colors.text },
  h3:      { fontSize: 15, fontWeight: '600' as const, lineHeight: 20, color: Colors.text },
  body:    { fontSize: 14, fontWeight: '400' as const, lineHeight: 20, color: Colors.text },
  small:   { fontSize: 13, fontWeight: '400' as const, lineHeight: 18, color: Colors.textSub },
  caption: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.8, textTransform: 'uppercase' as const, color: Colors.textMuted },
  label:   { fontSize: 12, fontWeight: '600' as const, letterSpacing: 0.3, color: Colors.textSub },
  mono:    { fontSize: 13, fontFamily: 'monospace' as const, color: Colors.text },
};

export const Spacing = {
  xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48,
};

export const Radius = {
  sm: 6, md: 10, lg: 14, xl: 18, xxl: 24, full: 9999,
};

export const Shadow = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  glow: (color: string) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 8,
  }),
};
