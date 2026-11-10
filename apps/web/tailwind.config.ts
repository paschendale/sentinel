import type { Config } from 'tailwindcss'

// Every colour, radius, width and font comes from the design tokens (app/styles/tokens.css),
// so utilities such as `bg-surface`, `text-fg-muted` or `border-border` follow the theme.
const token = (name: string) => `var(--${name})`

const COLORS = [
  'bg', 'surface', 'surface-raised', 'overlay', 'scrim', 'border', 'border-strong',
  'fg', 'fg-muted', 'fg-subtle', 'primary', 'on-primary', 'accent',
  'operational', 'operational-solid', 'operational-tint',
  'degraded', 'degraded-solid', 'degraded-tint',
  'outage', 'outage-solid', 'outage-tint',
  'unknown-solid', 'strip-empty',
] as const

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    // Replace, not extend: the stock palette (zinc, red, emerald, …) is not available.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      ...Object.fromEntries(COLORS.map((c) => [c, token(c)])),
    },
    fontFamily: {
      mono: [token('font-mono')],
      sans: [token('font-sans')],
    },
    extend: {
      spacing: { 'sp-1': token('space-1'), 'sp-2': token('space-2'), 'sp-3': token('space-3'), 'sp-4': token('space-4'), 'sp-6': token('space-6'), 'sp-8': token('space-8'), 'sp-12': token('space-12') },
      borderRadius: { xs: token('radius-xs'), sm: token('radius-sm'), md: token('radius-md'), full: token('radius-full') },
      maxWidth: { page: token('page-max'), form: token('form-max'), prose: token('prose-max') },
      boxShadow: { popover: token('shadow-popover') },
    },
  },
  plugins: [],
}

export default config
