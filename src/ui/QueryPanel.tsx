import { useMemo, useState } from 'react'
import type { Query } from '../core/query'
import { describePredicate, isEmpty, sparkCode } from '../core/query'
import type { TableSummary } from '../core/summary'
import type { ViewStats } from '../core/execute'
import { formatCount } from '../core/format'

interface Props {
  query: Query
  summary: TableSummary
  stats: ViewStats | null
  rowCount: number
  running: boolean
  progress: number
  readError: string | null
  loadedBlocks: number
  pendingBlocks: number
  onRemoveFilter: (index: number) => void
  onClearSelect: () => void
  onClearSort: () => void
  onClearScope: () => void
  onReset: () => void
}

export function QueryPanel({
  query, summary, stats, rowCount, running, progress, readError, loadedBlocks, pendingBlocks,
  onRemoveFilter, onClearSelect, onClearSort, onClearScope, onReset,
}: Props) {
  const [open, setOpen] = useState(true)
  const [copied, setCopied] = useState(false)

  const code = useMemo(
    () =>
      sparkCode(query, {
        tableName: identifier(summary.name),
        path: summary.name,
        columns: summary.columns,
        partitionColumns: summary.partitionColumns,
        partPath:
          query.scopedPart !== null ? summary.parts[query.scopedPart]?.relativePath : undefined,
      }),
    [query, summary],
  )

  const untouched = isEmpty(query)

  return (
    <section className={`query-panel${open ? '' : ' collapsed'}`} data-testid="query-panel">
      <header>
        <button className="disclose" onClick={() => setOpen(!open)} data-testid="toggle-query-panel">
          {open ? '▾' : '▸'}
        </button>
        <strong>Spark equivalent</strong>
        <div className="chips">
          {query.scopedPart !== null && (
            <button className="chip scope" onClick={onClearScope} data-testid="chip-scope">
              part {query.scopedPart} <span aria-hidden>×</span>
            </button>
          )}
          {query.filters.map((predicate, index) => (
            <button
              key={`${predicate.column}-${predicate.op}`}
              className={`chip${summary.partitionColumns.includes(predicate.column) ? ' partition' : ''}`}
              onClick={() => onRemoveFilter(index)}
              data-testid={`chip-filter-${predicate.column}`}
              title="Remove this filter"
            >
              {describePredicate(predicate)} <span aria-hidden>×</span>
            </button>
          ))}
          {query.sort && (
            <button className="chip" onClick={onClearSort} data-testid="chip-sort">
              order by {query.sort.column} {query.sort.direction} <span aria-hidden>×</span>
            </button>
          )}
          {query.select.length > 0 && (
            <button className="chip" onClick={onClearSelect} data-testid="chip-select">
              {query.select.length} of {summary.columns.length} columns <span aria-hidden>×</span>
            </button>
          )}
        </div>
        <span className="spacer" />
        {!untouched && (
          <button onClick={onReset} data-testid="reset-query">
            Reset
          </button>
        )}
        <button
          onClick={async () => {
            await navigator.clipboard?.writeText(code)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
          data-testid="copy-query"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </header>

      {open && (
        <>
          <pre data-testid="query-code">{code}</pre>
          <div className="query-stats" data-testid="query-stats">
            {running ? (
              <>
                <span className="live">running</span>
                <span className="progress">
                  <i style={{ width: `${Math.round(progress * 100)}%` }} />
                </span>
              </>
            ) : untouched ? (
              <span>{formatCount(summary.totalRows)} rows, nothing applied yet</span>
            ) : (
              <>
                <span>
                  <strong>{formatCount(rowCount)}</strong> of {formatCount(summary.totalRows)} rows
                </span>
                {stats && stats.partitionsPruned > 0 && (
                  <span data-testid="stat-pruned">
                    {stats.partitionsPruned} partition{stats.partitionsPruned === 1 ? '' : 's'} pruned
                  </span>
                )}
                {stats && stats.rowGroupsSkipped > 0 && (
                  <span data-testid="stat-skipped">
                    {stats.rowGroupsSkipped} of {stats.rowGroupsTotal} row groups skipped unread
                  </span>
                )}
                {stats && stats.rowsScanned > 0 && (
                  <span>{formatCount(stats.rowsScanned)} rows scanned</span>
                )}
                {stats && <span>{stats.elapsedMs} ms</span>}
              </>
            )}
            <span className="spacer" />
            {readError && (
              <span style={{ color: 'var(--danger)' }} data-testid="read-error">
                {readError}
              </span>
            )}
            {pendingBlocks > 0 && <span className="live">decoding</span>}
            <span data-testid="cache-state">{loadedBlocks} blocks cached</span>
          </div>
          {stats && stats.rowGroupsSkipped > 0 && !running && (
            <p className="query-teach">
              Those row groups were never read. Their min/max statistics proved no row inside could
              match, which is exactly the pushdown Spark performs.
            </p>
          )}
        </>
      )}
    </section>
  )
}

function identifier(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_')
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `df_${cleaned}`
}
