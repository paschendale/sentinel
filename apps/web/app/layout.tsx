import type { Metadata } from 'next'
import { Inconsolata, Inter } from 'next/font/google'
import { THEME_BOOT_SCRIPT } from '../lib/theme'
import './globals.css'

// Self-hosted at build time by next/font: no request to Google at runtime.
const mono = Inconsolata({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-inconsolata', display: 'swap' })
const sans = Inter({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-inter', display: 'swap' })

export const metadata: Metadata = {
  title: { default: 'Sentinel', template: '%s · Sentinel' },
  description: 'Synthetic testing and uptime monitoring',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mono.variable} ${sans.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
