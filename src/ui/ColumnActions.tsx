import { useState } from 'react'
import type { PredicateOp, Query } from '../core/query'
import type { CellValue, TableColumn } from '../core/types'

interface Props {
  column: TableColumn
  query: Query
  suggestions: string[]
  onToggleSelect: () => void
  onSort: (direction: 'asc' | 'desc') => void
  onFilter: (op: PredicateOp, value: CellValue) => void
}

const NUMERIC_OPS: PredicateOp[] = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'isNull', 'notNull']
const TEXT_OPS: PredicateOp[] = ['eq', 'ne', 'contains', 'isNull', 'notNull']

const OP_LABEL: Record<PredicateOp, string> = {
  eq: '=', ne: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=',
  isNull: 'is null', notNull: 'is not null', contains: 'contains',
}

export function ColumnActions({ column, query, suggestions, onToggleSelect, onSort, onFilter }: Props) {
  const numeric = isNumeric(column)
  const [op, setOp] = useState<PredicateOp>('eq')
  const [text, setText] = useState('')

  const selected = query.select.includes(column.name)
  const sorted = query.sort?.column === column.name ? query.sort.direction : null
  const needsValue = op !== 'isNull' && op !== 'notNull'
  const ops = numeric ? NUMERIC_OPS : TEXT_OPS

  const apply = () => {
    if (needsValue && text === '') return
    onFilter(op, needsValue ? coerce(text, numeric) : null)
    setText('')
  }

  return (
    <>
      <div className="actions">
        <button
          className={selected ? 'on' : ''}
          onClick={onToggleSelect}
          data-testid="action-select"
        >
          {selected ? 'In select()' : 'Add to select()'}
        </button>
        <button
          className={sorted === 'asc' ? 'on' : ''}
          onClick={() => onSort('asc')}
          data-testid="action-sort-asc"
        >
          Sort ↑
        </button>
        <button
          className={sorted === 'desc' ? 'on' : ''}
          onClick={() => onSort('desc')}
          data-testid="action-sort-desc"
        >
          Sort ↓
        </button>
      </div>

      <div className="filter-builder">
        <select
          value={op}
          onChange={(event) => setOp(event.target.value as PredicateOp)}
          aria-label={`Filter operator for ${column.name}`}
          data-testid="filter-op"
        >
          {ops.map((candidate) => (
            <option key={candidate} value={candidate}>
              {OP_LABEL[candidate]}
            </option>
          ))}
        </select>
        {needsValue && (
          <input
            value={text}
            list={suggestions.length ? `values-${column.name}` : undefined}
            placeholder={numeric ? 'number' : 'value'}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && apply()}
            aria-label={`Filter value for ${column.name}`}
            data-testid="filter-value"
          />
        )}
        <button onClick={apply} data-testid="apply-filter">
          Filter
        </button>
        {suggestions.length > 0 && (
          <datalist id={`values-${column.name}`}>
            {suggestions.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        )}
      </div>
    </>
  )
}

function isNumeric(column: TableColumn): boolean {
  if (column.origin === 'partition') return false
  return (
    column.physicalType === 'INT32' ||
    column.physicalType === 'INT64' ||
    column.physicalType === 'FLOAT' ||
    column.physicalType === 'DOUBLE'
  )
}

function coerce(text: string, numeric: boolean): CellValue {
  if (!numeric) return text
  const value = Number(text)
  return Number.isFinite(value) ? value : text
}
