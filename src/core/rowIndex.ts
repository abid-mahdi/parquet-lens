import type { PartFile } from './types'

export interface RowLocation {
  partIndex: number
  localRow: number
}

/** Maps a table-wide row index onto the part file that physically holds it. */
export function locateRow(parts: PartFile[], globalRow: number): RowLocation | null {
  let low = 0
  let high = parts.length - 1

  while (low <= high) {
    const mid = (low + high) >> 1
    const part = parts[mid]
    if (!part) return null

    if (globalRow < part.firstRow) high = mid - 1
    else if (globalRow >= part.firstRow + part.rowCount) low = mid + 1
    else return { partIndex: mid, localRow: globalRow - part.firstRow }
  }
  return null
}

export interface PartSlice {
  partIndex: number
  rowStart: number
  rowEnd: number
  globalStart: number
}

/** Splits a table-wide row range into per-part local ranges. */
export function sliceRange(parts: PartFile[], start: number, end: number): PartSlice[] {
  const slices: PartSlice[] = []

  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]
    if (!part) continue

    const partStart = part.firstRow
    const partEnd = part.firstRow + part.rowCount
    if (partEnd <= start) continue
    if (partStart >= end) break

    const from = Math.max(start, partStart)
    const to = Math.min(end, partEnd)
    if (to <= from) continue

    slices.push({
      partIndex: index,
      rowStart: from - partStart,
      rowEnd: to - partStart,
      globalStart: from,
    })
  }
  return slices
}

/**
 * Row groups are the unit hyparquet decompresses, so an unaligned window
 * decodes the same pages repeatedly. Snapping to boundaries makes cache hits real.
 */
export function alignToRowGroups(part: PartFile, start: number, end: number): { start: number; end: number } {
  let cursor = 0
  let alignedStart = start
  let alignedEnd = end

  for (const group of part.metadata.row_groups) {
    const groupRows = Number(group.num_rows)
    const groupEnd = cursor + groupRows

    if (start >= cursor && start < groupEnd) alignedStart = cursor
    if (end > cursor && end <= groupEnd) alignedEnd = groupEnd

    cursor = groupEnd
  }

  return { start: alignedStart, end: Math.min(alignedEnd, part.rowCount) }
}
