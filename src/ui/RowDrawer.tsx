import { formatValue, isComplex, jsonSafe } from '../core/format'
import type { Row, TableColumn } from '../core/types'
import { SparkSnippet } from './SparkSnippet'

interface Props {
  index: number
  row: Row | undefined
  columns: TableColumn[]
  tableName: string
  onClose: () => void
}

export function RowDrawer({ index, row, columns, tableName, onClose }: Props) {
  return (
    <div className="drawer" data-testid="row-drawer">
      <header>
        <h3>Row {index + 1}</h3>
        <span className="spacer" />
        <button onClick={onClose} data-testid="close-drawer">
          Close
        </button>
      </header>
      <div className="body">
        {row === undefined ? (
          <p style={{ color: 'var(--text-dim)' }}>Loading row...</p>
        ) : (
          <>
            <div className="kv">
              {columns.map((column) => {
                const value = row[column.name]
                const nullish = value === null || value === undefined
                return (
                  <ValuePair
                    key={column.name}
                    column={column}
                    text={nullish ? 'null' : pretty(value)}
                    nullish={nullish}
                  />
                )
              })}
            </div>
            <SparkSnippet
              label="Spark equivalent"
              code={`${tableName}.filter($"${columns[0]?.name ?? 'id'}" === ${literal(row[columns[0]?.name ?? ''])}).show(1, truncate = false)`}
            />
          </>
        )}
      </div>
    </div>
  )
}

function ValuePair({
  column,
  text,
  nullish,
}: {
  column: TableColumn
  text: string
  nullish: boolean
}) {
  return (
    <>
      <div className={`k${column.origin === 'partition' ? ' partition' : ''}`}>{column.name}</div>
      <div className={`v${nullish ? ' null' : ''}`}>{text}</div>
    </>
  )
}

function pretty(value: unknown): string {
  return isComplex(value) ? JSON.stringify(value, jsonSafe, 2) : formatValue(value)
}

function literal(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`
  if (value === null || value === undefined) return 'null'
  return formatValue(value)
}
