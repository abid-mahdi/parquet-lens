import { useEffect } from 'react'

export interface KeyboardTargets {
  enabled: boolean
  rowCount: number
  selectedRow: number | null
  pageSize: number
  onSelectRow: (index: number) => void
  onDismiss: () => void
  onCopyRow: () => void
}

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** Arrow-key row navigation, Escape to dismiss, and copy for the selected row. */
export function useKeyboardNavigation({
  enabled, rowCount, selectedRow, pageSize, onSelectRow, onDismiss, onCopyRow,
}: KeyboardTargets): void {
  useEffect(() => {
    if (!enabled) return

    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (TYPING.has(target.tagName) || target.isContentEditable)) return

      if (event.key === 'Escape') {
        onDismiss()
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c' && selectedRow !== null) {
        onCopyRow()
        return
      }

      const next = nextIndex(event.key, selectedRow, rowCount, pageSize)
      if (next === null) return

      event.preventDefault()
      onSelectRow(next)
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [enabled, rowCount, selectedRow, pageSize, onSelectRow, onDismiss, onCopyRow])
}

export function nextIndex(
  key: string,
  current: number | null,
  rowCount: number,
  pageSize: number,
): number | null {
  if (rowCount === 0) return null
  const last = rowCount - 1
  const from = current ?? -1

  switch (key) {
    case 'ArrowDown': return clamp(from + 1, last)
    case 'ArrowUp': return current === null ? null : clamp(from - 1, last)
    case 'PageDown': return clamp(from + pageSize, last)
    case 'PageUp': return current === null ? null : clamp(from - pageSize, last)
    case 'Home': return 0
    case 'End': return last
    default: return null
  }
}

function clamp(value: number, last: number): number {
  return Math.max(0, Math.min(value, last))
}
