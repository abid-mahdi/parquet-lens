import type { CellValue, TableColumn } from './types'

export type PredicateOp =
  | 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'isNull' | 'notNull' | 'contains'

export interface Predicate {
  column: string
  op: PredicateOp
  value: CellValue
}

export interface SortSpec {
  column: string
  direction: 'asc' | 'desc'
}

export interface Query {
  select: string[]
  filters: Predicate[]
  sort: SortSpec | null
  scopedPart: number | null
  limit: number | null
}

export const emptyQuery: Query = {
  select: [],
  filters: [],
  sort: null,
  scopedPart: null,
  limit: null,
}

export function isEmpty(query: Query): boolean {
  return (
    query.select.length === 0 &&
    query.filters.length === 0 &&
    query.sort === null &&
    query.scopedPart === null &&
    query.limit === null
  )
}

export function toggleSelected(query: Query, column: string): Query {
  const select = query.select.includes(column)
    ? query.select.filter((name) => name !== column)
    : [...query.select, column]
  return { ...query, select }
}

export function withFilter(query: Query, predicate: Predicate): Query {
  const others = query.filters.filter(
    (existing) => !(existing.column === predicate.column && existing.op === predicate.op),
  )
  return { ...query, filters: [...others, predicate] }
}

export function withoutFilter(query: Query, index: number): Query {
  return { ...query, filters: query.filters.filter((_, i) => i !== index) }
}

export function cycleSort(query: Query, column: string): Query {
  if (query.sort?.column !== column) return { ...query, sort: { column, direction: 'asc' } }
  if (query.sort.direction === 'asc') return { ...query, sort: { column, direction: 'desc' } }
  return { ...query, sort: null }
}

const OPERATOR_LABEL: Record<PredicateOp, string> = {
  eq: '===', ne: '=!=', gt: '>', gte: '>=', lt: '<', lte: '<=',
  isNull: 'isNull', notNull: 'isNotNull', contains: 'contains',
}

export function describePredicate(predicate: Predicate): string {
  if (predicate.op === 'isNull' || predicate.op === 'notNull') {
    return `${predicate.column}.${OPERATOR_LABEL[predicate.op]}`
  }
  return `${predicate.column} ${OPERATOR_LABEL[predicate.op]} ${literal(predicate.value)}`
}

export interface SparkCodeOptions {
  tableName: string
  path: string
  columns: TableColumn[]
  partitionColumns: string[]
  partPath?: string
}

/** Renders the accumulated clicks as the Scala a reader would type in spark-shell. */
export function sparkCode(query: Query, options: SparkCodeOptions): string {
  const { tableName, path } = options
  const lines: string[] = [`val ${tableName} = spark.read.parquet("${path}")`, '']

  if (query.scopedPart !== null && options.partPath) {
    lines.push(`// one part file only, the slice a single Spark task reads`)
    lines.push(`val part = spark.read.parquet("${options.partPath}")`)
    lines.push('')
  }

  const chain: string[] = [query.scopedPart !== null && options.partPath ? 'part' : tableName]

  const partitionFilters = query.filters.filter((f) => options.partitionColumns.includes(f.column))
  const dataFilters = query.filters.filter((f) => !options.partitionColumns.includes(f.column))

  const clauses = [
    ...partitionFilters.map((filter) => ({
      text: `  .filter(${sparkPredicate(filter)})`,
      note: 'prunes whole directories',
    })),
    ...dataFilters.map((filter) => ({ text: `  .filter(${sparkPredicate(filter)})`, note: null })),
  ]
  const widest = Math.max(0, ...clauses.filter((c) => c.note).map((c) => c.text.length))
  for (const clause of clauses) {
    chain.push(clause.note ? `${clause.text.padEnd(widest + 2)}// ${clause.note}` : clause.text)
  }

  if (query.select.length > 0) {
    chain.push(`  .select(${query.select.map((c) => `$"${c}"`).join(', ')})`)
  }

  if (query.sort) {
    const direction = query.sort.direction === 'desc' ? '.desc' : '.asc'
    chain.push(`  .orderBy($"${query.sort.column}"${direction})`)
  }

  chain.push(`  .show(${query.limit ?? 20}, truncate = false)`)
  lines.push(chain.join('\n'))
  return lines.join('\n')
}

export function sparkPredicate(predicate: Predicate): string {
  const column = `$"${predicate.column}"`
  switch (predicate.op) {
    case 'isNull':
      return `${column}.isNull`
    case 'notNull':
      return `${column}.isNotNull`
    case 'contains':
      return `${column}.contains(${literal(predicate.value)})`
    default:
      return `${column} ${OPERATOR_LABEL[predicate.op]} ${literal(predicate.value)}`
  }
}

export function literal(value: CellValue): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return `"${value.replace(/"/g, '\\"')}"`
  if (typeof value === 'bigint') return `${value}L`
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number') return String(value)
  return `"${String(value)}"`
}

export function matches(predicate: Predicate, value: CellValue): boolean {
  if (predicate.op === 'isNull') return value === null || value === undefined
  if (predicate.op === 'notNull') return value !== null && value !== undefined
  if (value === null || value === undefined) return false

  if (predicate.op === 'contains') {
    return String(value).toLowerCase().includes(String(predicate.value).toLowerCase())
  }

  const comparison = compare(value, predicate.value)
  if (comparison === null) return false

  switch (predicate.op) {
    case 'eq': return comparison === 0
    case 'ne': return comparison !== 0
    case 'gt': return comparison > 0
    case 'gte': return comparison >= 0
    case 'lt': return comparison < 0
    case 'lte': return comparison <= 0
  }
}

export function compare(a: CellValue, b: CellValue): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null

  if (typeof a === 'bigint' || typeof b === 'bigint') {
    const left = BigInt(a as never)
    const right = BigInt(b as never)
    return left < right ? -1 : left > right ? 1 : 0
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)

  const left = String(a)
  const right = String(b)
  return left < right ? -1 : left > right ? 1 : 0
}

/** Null-last ordering, matching Spark's default for ascending sorts. */
export function compareForSort(a: CellValue, b: CellValue, direction: 'asc' | 'desc'): number {
  const aNull = a === null || a === undefined
  const bNull = b === null || b === undefined
  if (aNull && bNull) return 0
  if (aNull) return 1
  if (bNull) return -1

  const result = compare(a, b) ?? 0
  return direction === 'desc' ? -result : result
}
