import { formatBytes, formatCount } from '../core/format'
import type { TableSummary } from '../core/summary'
import type { Theme } from '../theme'

interface Props {
  summary: TableSummary | null
  rowCount: number
  columnCount: number
  theme: Theme
  onToggleTheme: () => void
  onClose: () => void
}

export function TopBar({ summary, rowCount, columnCount, theme, onToggleTheme, onClose }: Props) {
  const filtered = summary !== null && rowCount !== summary.totalRows

  return (
    <header className="topbar">
      <h1>
        Parquet <span>Lens</span>
      </h1>
      {summary && (
        <>
          <span className="badge">{summary.name}</span>
          <span className="badge" data-testid="row-count">
            {formatCount(rowCount)}
            {filtered ? ` of ${formatCount(summary.totalRows)}` : ''} rows
          </span>
          <span className="badge">{columnCount} cols</span>
          <span className="badge">
            {summary.parts.length} part{summary.parts.length === 1 ? '' : 's'}
          </span>
          <span className="badge">{formatBytes(summary.totalBytes)}</span>
        </>
      )}
      <span className="spacer" />
      <span className="badge private">Nothing uploaded</span>
      {summary && <button onClick={onClose}>Close</button>}
      <button onClick={onToggleTheme} data-testid="theme-toggle">
        {theme === 'dark' ? 'Light' : 'Dark'}
      </button>
    </header>
  )
}
