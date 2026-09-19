import { parquetReadObjects } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'
import type { PartFile, Row, SparkTable } from './types'
import { alignToRowGroups, sliceRange } from './rowIndex'

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

async function readPart(
  part: PartFile,
  rowStart: number,
  rowEnd: number,
  columns: string[] | undefined,
): Promise<Row[]> {
  const fileColumns = columns?.filter((name) => !(name in part.partitions))
  return (await parquetReadObjects({
    file: await part.source.open(),
    metadata: part.metadata,
    columns: fileColumns?.length ? fileColumns : undefined,
    rowStart,
    rowEnd,
    compressors,
    utf8: true,
  })) as Row[]
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
