import { parquetReadObjects } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'
import type { Statistics } from 'hyparquet'
import type { RowGroup } from 'hyparquet'
import type { CellValue, PartFile, Row, SparkTable } from './types'
import type { Predicate, Query } from './query'
import { compare, compareForSort, matches } from './query'
import { normalizeNulls } from './nulls'

export interface ViewStats {
  rowGroupsTotal: number
  rowGroupsSkipped: number
  rowsScanned: number
  rowsMatched: number
  partitionsPruned: number
  elapsedMs: number
}

export interface TableView {
  /** Physical row indices in display order, or null when the view is the table itself. */
  indices: Int32Array | null
  rowCount: number
  stats: ViewStats
}

const IDENTITY_STATS: ViewStats = {
  rowGroupsTotal: 0, rowGroupsSkipped: 0, rowsScanned: 0,
  rowsMatched: 0, partitionsPruned: 0, elapsedMs: 0,
}

export function identityView(table: SparkTable): TableView {
  return {
    indices: null,
    rowCount: table.totalRows,
    stats: { ...IDENTITY_STATS, rowGroupsTotal: table.rowGroupCount },
  }
}

export interface BuildViewOptions {
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}

/**
 * Turns a query into an ordered list of physical row indices.
 *
 * Row groups whose statistics cannot satisfy a predicate are skipped without
 * reading them, which is the same mechanism Spark calls predicate pushdown.
 */
export async function buildView(
  table: SparkTable,
  query: Query,
  options: BuildViewOptions = {},
): Promise<TableView> {
  const started = Date.now()
  const needsFilter = query.filters.length > 0
  const needsSort = query.sort !== null

  if (!needsFilter && !needsSort) {
    const view = identityView(table)
    return { ...view, stats: { ...view.stats, elapsedMs: Date.now() - started } }
  }

  const partitionFilters = query.filters.filter((f) => isPartitionColumn(table, f.column))
  const dataFilters = query.filters.filter((f) => !isPartitionColumn(table, f.column))
  const columnsNeeded = [
    ...new Set([...dataFilters.map((f) => f.column), ...(query.sort ? [query.sort.column] : [])]),
  ]

  const stats: ViewStats = { ...IDENTITY_STATS, rowGroupsTotal: table.rowGroupCount }
  const matchedIndices: number[] = []
  const sortValues: CellValue[] = []

  for (const [partIndex, part] of table.parts.entries()) {
    throwIfAborted(options.signal)
    options.onProgress?.(partIndex / table.parts.length)

    if (!partitionMatches(part, partitionFilters)) {
      stats.partitionsPruned++
      stats.rowGroupsSkipped += part.metadata.row_groups.length
      continue
    }

    let groupStart = 0
    for (const group of part.metadata.row_groups) {
      throwIfAborted(options.signal)
      const groupRows = Number(group.num_rows)
      const groupEnd = groupStart + groupRows

      if (canSkipRowGroup(group, dataFilters)) {
        stats.rowGroupsSkipped++
        groupStart = groupEnd
        continue
      }

      // Nothing to read: the partition filter alone decided this group, so the
      // whole range qualifies without touching the file.
      if (columnsNeeded.length === 0) {
        for (let offset = 0; offset < groupRows; offset++) {
          matchedIndices.push(part.firstRow + groupStart + offset)
        }
        groupStart = groupEnd
        continue
      }

      const rows = await readColumns(part, groupStart, groupEnd, columnsNeeded)
      stats.rowsScanned += rows.length

      for (let offset = 0; offset < rows.length; offset++) {
        const row = rows[offset]
        if (!row) continue
        if (!dataFilters.every((filter) => matches(filter, row[filter.column] ?? null))) continue

        matchedIndices.push(part.firstRow + groupStart + offset)
        if (query.sort) sortValues.push(row[query.sort.column] ?? null)
      }

      groupStart = groupEnd
    }
  }

  options.onProgress?.(1)
  stats.rowsMatched = matchedIndices.length

  let order = matchedIndices
  if (query.sort) {
    const direction = query.sort.direction
    const positions = matchedIndices.map((_, i) => i)
    positions.sort((a, b) => compareForSort(sortValues[a] ?? null, sortValues[b] ?? null, direction))
    order = positions.map((position) => matchedIndices[position] ?? 0)
  }

  return {
    indices: Int32Array.from(order),
    rowCount: order.length,
    stats: { ...stats, elapsedMs: Date.now() - started },
  }
}

/** Gathers scattered physical rows, batching contiguous runs into single reads. */
export async function readByIndices(
  indices: Int32Array,
  start: number,
  end: number,
  columns: string[] | undefined,
  readRange: (from: number, to: number, cols: string[] | undefined) => Promise<Row[]>,
): Promise<Row[]> {
  const slice = Array.from(indices.slice(start, end))
  if (slice.length === 0) return []

  const runs: Array<{ from: number; to: number }> = []
  const sorted = [...new Set(slice)].sort((a, b) => a - b)

  let runStart = sorted[0] ?? 0
  let previous = runStart
  for (const index of sorted.slice(1)) {
    if (index === previous + 1) {
      previous = index
      continue
    }
    runs.push({ from: runStart, to: previous + 1 })
    runStart = index
    previous = index
  }
  runs.push({ from: runStart, to: previous + 1 })

  const byPhysicalIndex = new Map<number, Row>()
  for (const run of runs) {
    const rows = await readRange(run.from, run.to, columns)
    for (let offset = 0; offset < rows.length; offset++) {
      const row = rows[offset]
      if (row) byPhysicalIndex.set(run.from + offset, row)
    }
  }

  return slice.map((index) => byPhysicalIndex.get(index) ?? {})
}

function isPartitionColumn(table: SparkTable, column: string): boolean {
  return table.partitionColumns.includes(column)
}

function partitionMatches(part: PartFile, filters: Predicate[]): boolean {
  return filters.every((filter) => matches(filter, part.partitions[filter.column] ?? null))
}

/**
 * Min/max on a column chunk bound every value in it, so a predicate that cannot
 * be satisfied inside those bounds lets the whole group go unread.
 */
function canSkipRowGroup(group: RowGroup, filters: Predicate[]): boolean {
  if (filters.length === 0) return false

  return filters.some((filter) => {
    const chunk = group.columns.find(
      (candidate) => candidate.meta_data?.path_in_schema.join('.') === filter.column,
    )
    const statistics = chunk?.meta_data?.statistics
    return statistics ? cannotMatch(filter, statistics) : false
  })
}

function cannotMatch(filter: Predicate, statistics: Statistics): boolean {
  const min = (statistics.min_value ?? statistics.min) as CellValue | undefined
  const max = (statistics.max_value ?? statistics.max) as CellValue | undefined
  if (min === undefined || max === undefined || min === null || max === null) return false

  const belowMin = (value: CellValue) => lessThan(value, min)
  const aboveMax = (value: CellValue) => lessThan(max, value)
  const target = filter.value

  switch (filter.op) {
    case 'eq': return aboveMax(target) || belowMin(target)
    case 'gt': return !lessThan(target, max)
    case 'gte': return lessThan(max, target)
    case 'lt': return !lessThan(min, target)
    case 'lte': return lessThan(target, min)
    default: return false
  }
}

function lessThan(a: CellValue, b: CellValue): boolean {
  const result = compare(a, b)
  return result !== null && result < 0
}

async function readColumns(
  part: PartFile,
  rowStart: number,
  rowEnd: number,
  columns: string[],
): Promise<Row[]> {
  const rows = (await parquetReadObjects({
    file: await part.source.open(),
    metadata: part.metadata,
    columns,
    rowStart,
    rowEnd,
    compressors,
    utf8: true,
    useOffsetIndex: true,
  })) as Row[]
  return rows.map((row) => normalizeNulls(row) as Row)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('Query cancelled', 'AbortError')
}
