import type { Monaco } from '@monaco-editor/react'

/** The token values the editor uses, read from the page so a fork's token edits apply here too. */
export interface MonacoTheme {
  bg: string
  fg: string
  subtle: string
  border: string
  raised: string
  accent: string
  font: string
  dark: boolean
}

export function readTheme(): MonacoTheme {
  const css = getComputedStyle(document.documentElement)
  const v = (n: string) => css.getPropertyValue(`--${n}`).trim()
  return { bg: v('surface'), fg: v('fg'), subtle: v('fg-subtle'), border: v('border'), raised: v('surface-raised'), accent: v('accent'), font: v('font-mono'), dark: css.colorScheme !== 'light' }
}

/** Monaco wants #rrggbb; tokens are hex already. A value it cannot read is left out (Monaco keeps its own). */
function hex(v: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(v)) return v
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${[...v.slice(1)].map((c) => c + c).join('')}`
  return null
}

/**
 * The editor theme from surface, fg and fg-subtle: same ground, border and font as the
 * read-only CodeBlock, comments in fg-subtle and no syntax colours beyond that.
 */
export function defineTheme(monaco: Monaco, t: MonacoTheme): string {
  const name = t.dark ? 'sentinel-dark' : 'sentinel-light'
  const bg = hex(t.bg)
  const fg = hex(t.fg)
  const subtle = hex(t.subtle)
  const border = hex(t.border)
  const raised = hex(t.raised)
  const accent = hex(t.accent)
  const pairs: Array<[string, string | null]> = [
    ['editor.background', bg],
    ['editor.foreground', fg],
    ['editorLineNumber.foreground', subtle],
    ['editorLineNumber.activeForeground', fg],
    ['editorCursor.foreground', fg],
    ['editor.selectionBackground', border],
    ['editor.inactiveSelectionBackground', raised],
    ['editorIndentGuide.background1', raised],
    ['editorWidget.background', raised],
    ['editorWidget.border', border],
    ['editorSuggestWidget.background', raised],
    ['editorSuggestWidget.border', border],
    ['editorSuggestWidget.selectedBackground', border],
    ['focusBorder', accent],
    ['scrollbarSlider.background', border && `${border}99`],
    ['scrollbarSlider.hoverBackground', border && `${border}cc`],
  ]
  monaco.editor.defineTheme(name, {
    base: t.dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      ...(fg ? [{ token: '', foreground: fg.slice(1) }, { token: 'keyword', foreground: fg.slice(1) }, { token: 'string', foreground: fg.slice(1) }, { token: 'number', foreground: fg.slice(1) }, { token: 'identifier', foreground: fg.slice(1) }, { token: 'delimiter', foreground: fg.slice(1) }, { token: 'type', foreground: fg.slice(1) }] : []),
      ...(subtle ? [{ token: 'comment', foreground: subtle.slice(1), fontStyle: '' }] : []),
    ],
    colors: Object.fromEntries(pairs.filter((p): p is [string, string] => p[1] !== null)),
  })
  return name
}
