export const theme = {
  color: {
    background: '#07111f',
    surface: '#0b192a',
    surfaceRaised: '#10243b',
    border: '#29415e',
    text: '#e8f0fb',
    textMuted: '#9fb0c5',
    primary: '#38bdf8',
    accent: '#2dd4bf',
    warning: '#fbbf24',
    danger: '#fb7185',
  },
  spacing: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px' },
  radius: { sm: '8px', md: '14px', lg: '22px' },
  motion: { fast: '160ms', normal: '220ms', easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
} as const

export function applyTheme(): void {
  const root = document.documentElement
  Object.entries(theme.color).forEach(([name, value]) => root.style.setProperty(`--color-${name}`, value))
  Object.entries(theme.spacing).forEach(([name, value]) => root.style.setProperty(`--space-${name}`, value))
  Object.entries(theme.radius).forEach(([name, value]) => root.style.setProperty(`--radius-${name}`, value))
  Object.entries(theme.motion).forEach(([name, value]) => root.style.setProperty(`--motion-${name}`, value))
}
