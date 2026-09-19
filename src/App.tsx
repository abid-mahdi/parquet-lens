import { useCallback, useEffect, useMemo, useState } from 'react'
import { DropZone } from './ui/DropZone'
import { DataGrid } from './ui/DataGrid'
import { Legend } from './ui/Legend'
import { RowDrawer } from './ui/RowDrawer'
import { ColumnProfile } from './ui/ColumnProfile'
import { QueryPanel } from './ui/QueryPanel'
import { TopBar } from './ui/TopBar'
import { useParquetTable } from './hooks/useParquetTable'
import { useTableQuery } from './hooks/useTableQuery'
import { useRowWindow } from './hooks/useRowWindow'
import { cycleSort, toggleSelected, withFilter, withoutFilter } from './core/query'
import type { PredicateOp } from './core/query'
import type { CellValue } from './core/types'
import { applyTheme, preferredTheme, type Theme } from './theme'

export function App() {
  const table = useParquetTable()
  const { summary, client } = table

  const query = useTableQuery(client, summary?.totalRows ?? 0, table.reportError)
  const [selectedRow, setSelectedRow] = useState<number | null>(null)
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>(preferredTheme)

  useEffect(() => applyTheme(theme), [theme])
  useEffect(() => setSelectedRow(null), [query.version])

  const scope = useMemo(() => {
    if (!summary) return { offset: 0, count: 0 }
    if (query.query.scopedPart === null) return { offset: 0, count: query.rowCount }

    const part = summary.parts[query.query.scopedPart]
    return part
      ? { offset: part.firstRow, count: part.rowCount }
      : { offset: 0, count: query.rowCount }
  }, [summary, query.query.scopedPart, query.rowCount])

  const projected = useMemo(() => {
    if (!summary) return []
    if (query.query.select.length === 0) return summary.columns
    return summary.columns.filter((column) => query.query.select.includes(column.name))
  }, [summary, query.query.select])

  const columnNames = useMemo(() => projected.map((column) => column.name), [projected])
  const generation = `${query.version}:${query.query.scopedPart}`
  const rows = useRowWindow(client, query.rowCount, columnNames, generation)

  const scopedRows = useMemo(
    () => ({
      ...rows,
      getRow: (index: number) => rows.getRow(index + scope.offset),
      requestRange: (start: number, end: number) =>
        rows.requestRange(start + scope.offset, end + scope.offset),
    }),
    [rows, scope.offset],
  )

  const inspectRow = useCallback((index: number) => {
    setSelectedColumn(null)
    setSelectedRow(index)
  }, [])

  const inspectColumn = useCallback((name: string) => {
    setSelectedRow(null)
    setSelectedColumn(name)
  }, [])

  const filterToValue = useCallback(
    (column: string, value: CellValue) => {
      query.update((current) => withFilter(current, { column, op: 'eq', value }))
      setSelectedRow(null)
    },
    [query],
  )

  const activeColumn = summary?.columns.find((column) => column.name === selectedColumn) ?? null

  return (
    <div className="app">
      <TopBar
        summary={summary}
        rowCount={query.rowCount}
        columnCount={projected.length}
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        onClose={table.close}
      />

      {table.error && (
        <div className="error-panel" data-testid="error">
          <strong>Could not open that table</strong>
          <pre>{table.error}</pre>
        </div>
      )}

      <div className="workspace">
        <main className="main">
          {!summary ? (
            <DropZone onFiles={table.open} busy={table.opening} />
          ) : (
            <>
              <DataGrid
                columns={projected}
                totalRows={scope.count}
                window={scopedRows}
                selectedRow={selectedRow}
                selectedColumn={selectedColumn}
                selectedColumns={query.query.select}
                sort={query.query.sort}
                onSelectRow={inspectRow}
                onSelectColumn={inspectColumn}
                onSortColumn={(name) => query.update((current) => cycleSort(current, name))}
              />
              <QueryPanel
                query={query.query}
                summary={summary}
                stats={query.stats}
                rowCount={query.rowCount}
                running={query.running}
                progress={query.progress}
                readError={rows.error}
                loadedBlocks={rows.loadedBlocks}
                pendingBlocks={rows.pendingBlocks}
                onRemoveFilter={(index) => query.update((c) => withoutFilter(c, index))}
                onClearSelect={() => query.update((c) => ({ ...c, select: [] }))}
                onClearSort={() => query.update((c) => ({ ...c, sort: null }))}
                onClearScope={() => query.update((c) => ({ ...c, scopedPart: null }))}
                onReset={query.reset}
              />
            </>
          )}
        </main>

        {summary && (
          <Legend
            summary={summary}
            selectedColumn={selectedColumn}
            selectedColumns={query.query.select}
            onSelectColumn={inspectColumn}
            onToggleColumn={(name) => query.update((c) => toggleSelected(c, name))}
            onScopeToPart={(index) =>
              query.update((c) => ({ ...c, scopedPart: c.scopedPart === index ? null : index }))
            }
            scopedPart={query.query.scopedPart}
          />
        )}
      </div>

      {summary && selectedRow !== null && (
        <RowDrawer
          index={selectedRow + scope.offset}
          row={scopedRows.getRow(selectedRow)}
          columns={projected}
          onClose={() => setSelectedRow(null)}
          onFilterToValue={filterToValue}
        />
      )}

      {summary && activeColumn && (
        <ColumnProfile
          column={activeColumn}
          summary={summary}
          query={query.query}
          onClose={() => setSelectedColumn(null)}
          onToggleSelect={() => query.update((c) => toggleSelected(c, activeColumn.name))}
          onSort={(direction) =>
            query.update((c) => ({ ...c, sort: { column: activeColumn.name, direction } }))
          }
          onFilter={(op: PredicateOp, value: CellValue) =>
            query.update((c) => withFilter(c, { column: activeColumn.name, op, value }))
          }
        />
      )}
    </div>
  )
}
