import { parquetReadObjects } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'
import type { PartFile, Row, SparkTable } from './types'
import { alignToRowGroups, sliceRange } from './rowIndex'
import { parquetSchema } from 'hyparquet'
import { topLevelColumns } from './schema'

export interface ReadOptions {
  signal?: AbortSignal
}

/**
 * Reads a table-wide row range, fetching each part only for the rows it owns and
 * widening to row-group boundaries so repeated scrolls reuse decompressed pages.
 */
export async function readRows(
  table: SparkTable,
  start: number,
  end: number,
  columns: string[] | undefined,
  options: ReadOptions = {},
): Promise<Row[]> {
  const clampedStart = Math.max(0, Math.min(start, table.totalRows))
  const clampedEnd = Math.max(clampedStart, Math.min(end, table.totalRows))
  if (clampedEnd === clampedStart) return []

  const rows = new Array<Row>(clampedEnd - clampedStart)
  const slices = sliceRange(table.parts, clampedStart, clampedEnd)

  for (const slice of slices) {
    throwIfAborted(options.signal)
    const part = table.parts[slice.partIndex]
    if (!part) continue

    const aligned = alignToRowGroups(part, slice.rowStart, slice.rowEnd)
    const decoded = await readPart(part, aligned.start, aligned.end, columns)
    throwIfAborted(options.signal)

    const partitionValues = partitionCells(part, columns)
    for (let local = slice.rowStart; local < slice.rowEnd; local++) {
      const row = decoded[local - aligned.start]
      if (!row) continue
      const globalIndex = part.firstRow + local - clampedStart
      rows[globalIndex] = partitionValues ? { ...row, ...partitionValues } : row
    }
  }

  return rows
}

/**
 * Parts in one Spark directory can disagree on schema. Spark resolves a missing
 * column to null rather than failing the read, so this does the same.
 */
async function readPart(
  part: PartFile,
  rowStart: number,
  rowEnd: number,
  columns: string[] | undefined,
): Promise<Row[]> {
  const available = partColumnNames(part)
  const requested = columns?.filter((name) => !(name in part.partitions))
  const present = requested?.filter((name) => available.has(name))
  const missing = requested?.filter((name) => !available.has(name)) ?? []

  const rows = (await parquetReadObjects({
    file: await part.source.open(),
    metadata: part.metadata,
    columns: present?.length ? present : requested?.length ? [] : undefined,
    rowStart,
    rowEnd,
    compressors,
    utf8: true,
    useOffsetIndex: true,
  })) as Row[]

  if (missing.length === 0) return rows

  const filler: Row = {}
  for (const name of missing) filler[name] = null
  return rows.map((row) => ({ ...row, ...filler }))
}

const columnNameCache = new WeakMap<PartFile, Set<string>>()

function partColumnNames(part: PartFile): Set<string> {
  const cached = columnNameCache.get(part)
  if (cached) return cached

  const names = new Set(topLevelColumns(parquetSchema(part.metadata)).map((node) => node.element.name))
  columnNameCache.set(part, names)
  return names
}

function partitionCells(part: PartFile, columns: string[] | undefined): Row | null {
  const keys = Object.keys(part.partitions)
  if (keys.length === 0) return null

  const cells: Row = {}
  for (const key of keys) {
    if (columns && !columns.includes(key)) continue
    cells[key] = part.partitions[key] ?? null
  }
  return Object.keys(cells).length > 0 ? cells : null
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('Read cancelled', 'AbortError')
}
