export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'parquet-lens-theme'

export function preferredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // private browsing or blocked storage, fall through to the media query
  }
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/** Applied before the first paint so a light-preference machine never flashes. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // nothing to do, the attribute above is what actually themes the page
  }
}
