import { formatValue, isComplex, jsonSafe } from '../core/format'
import type { CellValue, Row, TableColumn } from '../core/types'

interface Props {
  index: number
  row: Row | undefined
  columns: TableColumn[]
  onClose: () => void
  onFilterToValue: (column: string, value: CellValue) => void
}

export function RowDrawer({ index, row, columns, onClose, onFilterToValue }: Props) {
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
          <div className="kv">
            {columns.map((column) => {
              const value = row[column.name]
              const nullish = value === null || value === undefined
              const filterable = !isComplex(value)

              return (
                <ValuePair
                  key={column.name}
                  column={column}
                  text={nullish ? 'null' : pretty(value)}
                  nullish={nullish}
                  onFilter={
                    filterable ? () => onFilterToValue(column.name, value ?? null) : undefined
                  }
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

interface PairProps {
  column: TableColumn
  text: string
  nullish: boolean
  onFilter?: () => void
}

function ValuePair({ column, text, nullish, onFilter }: PairProps) {
  return (
    <>
      <div className={`k${column.origin === 'partition' ? ' partition' : ''}`}>{column.name}</div>
      <div className={`v${nullish ? ' null' : ''}`}>
        <span className="val">{text}</span>
        {onFilter && (
          <button
            className="row-action"
            onClick={onFilter}
            title={`Filter the table to rows where ${column.name} equals this`}
            data-testid={`filter-to-${column.name}`}
          >
            filter
          </button>
        )}
      </div>
    </>
  )
}

function pretty(value: unknown): string {
  return isComplex(value) ? JSON.stringify(value, jsonSafe, 2) : formatValue(value)
}
