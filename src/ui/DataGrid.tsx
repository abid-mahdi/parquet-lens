import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Row, TableColumn } from '../core/types'
import { formatValue, isComplex } from '../core/format'
import type { RowWindow } from '../hooks/useRowWindow'

const ROW_HEIGHT = 28
const GUTTER_WIDTH = 68

interface Props {
  columns: TableColumn[]
  totalRows: number
  window: RowWindow
  selectedRow: number | null
  selectedColumn: string | null
  onSelectRow: (index: number) => void
  onSelectColumn: (name: string) => void
}

export function DataGrid({
  columns,
  totalRows,
  window: rowWindow,
  selectedRow,
  selectedColumn,
  onSelectRow,
  onSelectColumn,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  const widths = useMemo(() => columns.map(columnWidth), [columns])
  const totalWidth = useMemo(
    () => widths.reduce((sum, width) => sum + width, GUTTER_WIDTH),
    [widths],
  )

  const rows = useVirtualizer({
    count: totalRows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 14,
  })

  const cols = useVirtualizer({
    horizontal: true,
    count: columns.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => widths[index] ?? 160,
    overscan: 3,
  })

  const virtualRows = rows.getVirtualItems()
  const virtualCols = cols.getVirtualItems()

  const first = virtualRows[0]?.index ?? 0
  const last = virtualRows[virtualRows.length - 1]?.index ?? 0

  useEffect(() => {
    rowWindow.requestRange(first, last + 1)
  }, [rowWindow, first, last])

  // Pinning the row-number gutter through a CSS variable keeps horizontal
  // scrolling off the React render path entirely.
  const syncGutter = useCallback(() => {
    const scroller = scrollRef.current
    innerRef.current?.style.setProperty('--scroll-x', `${scroller?.scrollLeft ?? 0}px`)
  }, [])

  useLayoutEffect(syncGutter, [syncGutter])

  return (
    <div className="grid-wrap" ref={scrollRef} onScroll={syncGutter} data-testid="grid">
      <div
        className="grid-inner"
        ref={innerRef}
        style={{ width: totalWidth, height: rows.getTotalSize() + ROW_HEIGHT }}
      >
        <div className="grid-head" style={{ width: totalWidth }}>
          <div className="gutter" style={{ width: GUTTER_WIDTH }} />
          {virtualCols.map((item) => {
            const column = columns[item.index]
            if (!column) return null
            return (
              <div
                key={column.name}
                className={headClass(column, selectedColumn)}
                style={{ left: GUTTER_WIDTH + item.start, width: item.size }}
                title={`${column.name} — ${typeLabel(column)}`}
                onClick={() => onSelectColumn(column.name)}
                data-testid={`col-${column.name}`}
              >
                <span>{column.name}</span>
                <span className="type">{typeLabel(column)}</span>
              </div>
            )
          })}
        </div>

        {virtualRows.map((item) => {
          const row = rowWindow.getRow(item.index)
          return (
            <div
              key={item.key}
              className={rowClass(item.index, selectedRow)}
              style={{ width: totalWidth, transform: `translateY(${ROW_HEIGHT + item.start}px)` }}
              onClick={() => onSelectRow(item.index)}
              data-testid={`row-${item.index}`}
            >
              <div className="gutter" style={{ width: GUTTER_WIDTH }}>
                {item.index + 1}
              </div>
              {virtualCols.map((col) => {
                const column = columns[col.index]
                if (!column) return null
                return (
                  <Cell
                    key={column.name}
                    column={column}
                    value={row?.[column.name]}
                    loaded={row !== undefined}
                    left={GUTTER_WIDTH + col.start}
                    width={col.size}
                  />
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface CellProps {
  column: TableColumn
  value: Row[string] | undefined
  loaded: boolean
  left: number
  width: number
}

function Cell({ column, value, loaded, left, width }: CellProps) {
  if (!loaded) {
    return (
      <div className="cell" style={{ left, width }}>
        <i className="skeleton" />
      </div>
    )
  }

  const nullish = value === null || value === undefined
  const classes = ['cell']
  if (column.origin === 'partition') classes.push('partition')
  if (nullish) classes.push('null')
  else if (isComplex(value)) classes.push('complex')
  else if (typeof value === 'number' || typeof value === 'bigint') classes.push('number')

  const text = nullish ? 'null' : formatValue(value)
  return (
    <div className={classes.join(' ')} style={{ left, width }} title={text}>
      {text}
    </div>
  )
}

function headClass(column: TableColumn, selected: string | null): string {
  const classes = ['head-cell']
  if (column.origin === 'partition') classes.push('partition')
  if (column.name === selected) classes.push('selected')
  return classes.join(' ')
}

function rowClass(index: number, selected: number | null): string {
  const classes = ['row']
  if (index % 2 === 1) classes.push('odd')
  if (index === selected) classes.push('selected')
  return classes.join(' ')
}

function typeLabel(column: TableColumn): string {
  if (column.origin === 'partition') return 'partition'
  return column.sparkType ?? column.logicalType ?? column.physicalType ?? '?'
}

function columnWidth(column: TableColumn): number {
  if (column.origin === 'partition') return 120
  switch (column.physicalType) {
    case 'BOOLEAN':
      return 96
    case 'INT32':
    case 'FLOAT':
      return 120
    case 'INT64':
    case 'DOUBLE':
    case 'INT96':
      return 150
    case 'BYTE_ARRAY':
    case 'FIXED_LEN_BYTE_ARRAY':
      return 190
    default:
      return 220
  }
}
