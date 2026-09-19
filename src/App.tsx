import { useCallback, useEffect, useMemo, useState } from 'react'
import { DropZone } from './ui/DropZone'
import { DataGrid } from './ui/DataGrid'
import { Legend } from './ui/Legend'
import { RowDrawer } from './ui/RowDrawer'
import { ColumnProfile } from './ui/ColumnProfile'
import { useRowWindow } from './hooks/useRowWindow'
import { ParquetClient } from './worker/client'
import { tableNameFor } from './core/sources'
import { formatBytes, formatCount } from './core/format'
import type { TableSummary } from './core/summary'
import type { SourceFile } from './core/types'
import { applyTheme, preferredTheme, type Theme } from './theme'

export function App() {
  const [client, setClient] = useState<ParquetClient | null>(null)
  const [summary, setSummary] = useState<TableSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectedRow, setSelectedRow] = useState<number | null>(null)
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null)
  const [scopedPart, setScopedPart] = useState<number | null>(null)
  const [theme, setTheme] = useState<Theme>(preferredTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => () => client?.terminate(), [client])

  const openFiles = useCallback(
    async (sources: SourceFile[]) => {
      if (sources.length === 0) {
        setError('No .parquet files found in that drop. Spark writes them inside a directory.')
        return
      }

      setBusy(true)
      setError(null)
      setSummary(null)
      setSelectedRow(null)
      setSelectedColumn(null)
      setScopedPart(null)

      const next = new ParquetClient()
      try {
        const files = await Promise.all(
          sources.map(async (source) => ({
            file: await sourceToFile(source),
            relativePath: source.relativePath,
          })),
        )
        const opened = await next.open(tableNameFor(sources, 'df'), files)
        setClient((previous) => {
          previous?.terminate()
          return next
        })
        setSummary(opened)
      } catch (cause) {
        next.terminate()
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  const scope = useMemo(() => {
    if (!summary) return { offset: 0, count: 0 }
    if (scopedPart === null) return { offset: 0, count: summary.totalRows }
    const part = summary.parts[scopedPart]
    return part ? { offset: part.firstRow, count: part.rowCount } : { offset: 0, count: summary.totalRows }
  }, [summary, scopedPart])

  const columnNames = useMemo(() => summary?.columns.map((c) => c.name), [summary])
  const rowWindow = useRowWindow(client, summary?.totalRows ?? 0, columnNames)

  const scopedWindow = useMemo(
    () => ({
      ...rowWindow,
      getRow: (index: number) => rowWindow.getRow(index + scope.offset),
      requestRange: (start: number, end: number) =>
        rowWindow.requestRange(start + scope.offset, end + scope.offset),
    }),
    [rowWindow, scope.offset],
  )

  const activeColumn = summary?.columns.find((c) => c.name === selectedColumn) ?? null

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          Parquet <span>Lens</span>
        </h1>
        {summary && (
          <>
            <span className="badge">{summary.name}</span>
            <span className="badge">{formatCount(summary.totalRows)} rows</span>
            <span className="badge">{summary.columns.length} cols</span>
            <span className="badge">
              {summary.parts.length} part{summary.parts.length === 1 ? '' : 's'}
            </span>
            <span className="badge">{formatBytes(summary.totalBytes)}</span>
          </>
        )}
        <span className="spacer" />
        <span className="badge private">Nothing uploaded</span>
        {summary && (
          <button
            onClick={() => {
              client?.terminate()
              setClient(null)
              setSummary(null)
            }}
          >
            Close
          </button>
        )}
        <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} data-testid="theme-toggle">
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
      </header>

      {error && (
        <div className="error-panel" data-testid="error">
          <strong>Could not open that table</strong>
          <pre>{error}</pre>
        </div>
      )}

      <div className="workspace">
        <main className="main">
          {!summary ? (
            <DropZone onFiles={openFiles} busy={busy} />
          ) : (
            <>
              <DataGrid
                columns={summary.columns}
                totalRows={scope.count}
                window={scopedWindow}
                selectedRow={selectedRow}
                selectedColumn={selectedColumn}
                onSelectRow={(index) => {
                  setSelectedColumn(null)
                  setSelectedRow(index)
                }}
                onSelectColumn={(name) => {
                  setSelectedRow(null)
                  setSelectedColumn(name)
                }}
              />
              <div className="statusbar" data-testid="statusbar">
                <span>
                  {scopedPart === null
                    ? `${formatCount(summary.totalRows)} rows`
                    : `part ${scopedPart}: ${formatCount(scope.count)} rows`}
                </span>
                <span>{summary.rowGroupCount} row groups</span>
                <span>{summary.compressionRatio.toFixed(1)}x compressed</span>
                <span className="spacer" />
                {rowWindow.error && (
                  <span style={{ color: 'var(--danger)' }} data-testid="read-error">
                    {rowWindow.error}
                  </span>
                )}
                {rowWindow.pendingBlocks > 0 && <span className="live">decoding...</span>}
                <span>{rowWindow.loadedBlocks} blocks cached</span>
                {scopedPart !== null && <button onClick={() => setScopedPart(null)}>Show all parts</button>}
              </div>
            </>
          )}
        </main>

        {summary && (
          <Legend
            summary={summary}
            selectedColumn={selectedColumn}
            onSelectColumn={(name) => {
              setSelectedRow(null)
              setSelectedColumn(name)
            }}
            onScopeToPart={(index) => setScopedPart((current) => (current === index ? null : index))}
            scopedPart={scopedPart}
          />
        )}
      </div>

      {summary && selectedRow !== null && (
        <RowDrawer
          index={selectedRow + scope.offset}
          row={scopedWindow.getRow(selectedRow)}
          columns={summary.columns}
          tableName={summary.name}
          onClose={() => setSelectedRow(null)}
        />
      )}

      {summary && activeColumn && (
        <ColumnProfile column={activeColumn} summary={summary} onClose={() => setSelectedColumn(null)} />
      )}
    </div>
  )
}

/** The worker needs a transferable File, which the browser source already wraps. */
async function sourceToFile(source: SourceFile): Promise<File> {
  const withFile = source as SourceFile & { file?: File }
  if (withFile.file) return withFile.file

  const buffer = await source.open()
  const bytes = await buffer.slice(0, buffer.byteLength)
  return new File([bytes], source.name)
}
