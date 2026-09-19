import { describe, expect, it } from 'vitest'
import { alignToRowGroups, locateRow, sliceRange } from '../../src/core/rowIndex'
import { buildTable } from '../../src/core/table'
import { fixtureSources } from '../helpers'

const table = await buildTable('multipart', await fixtureSources('multipart'))

describe('locateRow', () => {
  it('maps the first and last row of the table', () => {
    expect(locateRow(table.parts, 0)).toEqual({ partIndex: 0, localRow: 0 })

    const last = locateRow(table.parts, table.totalRows - 1)
    expect(last?.partIndex).toBe(table.parts.length - 1)
  })

  it('maps every part boundary exactly', () => {
    for (const [index, part] of table.parts.entries()) {
      expect(locateRow(table.parts, part.firstRow)).toEqual({ partIndex: index, localRow: 0 })
      expect(locateRow(table.parts, part.firstRow + part.rowCount - 1)).toEqual({
        partIndex: index,
        localRow: part.rowCount - 1,
      })
    }
  })

  it('returns null outside the table', () => {
    expect(locateRow(table.parts, -1)).toBeNull()
    expect(locateRow(table.parts, table.totalRows)).toBeNull()
  })
})

describe('sliceRange', () => {
  it('covers a range spanning several parts with no gaps or overlap', () => {
    const slices = sliceRange(table.parts, 100, table.totalRows - 100)
    const covered = slices.reduce((sum, s) => sum + (s.rowEnd - s.rowStart), 0)
    expect(covered).toBe(table.totalRows - 200)

    for (const [i, slice] of slices.entries()) {
      if (i === 0) continue
      const previous = slices[i - 1]
      expect(slice.globalStart).toBe((previous?.globalStart ?? 0) + ((previous?.rowEnd ?? 0) - (previous?.rowStart ?? 0)))
    }
  })

  it('returns a single slice for a range inside one part', () => {
    expect(sliceRange(table.parts, 10, 20)).toHaveLength(1)
  })

  it('returns nothing for an empty range', () => {
    expect(sliceRange(table.parts, 50, 50)).toHaveLength(0)
  })
})

describe('alignToRowGroups', () => {
  it('widens a window outward to row-group boundaries', async () => {
    const many = await buildTable('rg', await fixtureSources('manyrowgroups'))
    const part = many.parts[0]
    expect(part).toBeDefined()
    expect(part!.metadata.row_groups.length).toBeGreaterThan(1)

    const aligned = alignToRowGroups(part!, 5000, 5100)
    expect(aligned.start).toBeLessThanOrEqual(5000)
    expect(aligned.end).toBeGreaterThanOrEqual(5100)
  })

  it('never widens past the end of the part', async () => {
    const many = await buildTable('rg', await fixtureSources('manyrowgroups'))
    const part = many.parts[0]!
    const aligned = alignToRowGroups(part, part.rowCount - 10, part.rowCount)
    expect(aligned.end).toBeLessThanOrEqual(part.rowCount)
  })
})

describe('alignToRowGroups with oversized row groups', () => {
  it('does not widen a small request into a huge row group', async () => {
    const many = await buildTable('rg', await fixtureSources('manyrowgroups'))
    const part = many.parts[0]!
    const huge = {
      ...part,
      metadata: { ...part.metadata, row_groups: [{ ...part.metadata.row_groups[0]!, num_rows: 300_000n }] },
      rowCount: 300_000,
    }

    const aligned = alignToRowGroups(huge, 150_000, 150_256)
    expect(aligned.end - aligned.start).toBeLessThanOrEqual(4096)
  })

  it('still aligns when the row group is small enough to be worth it', async () => {
    const many = await buildTable('rg', await fixtureSources('manyrowgroups'))
    const part = many.parts[0]!
    const groupRows = Number(part.metadata.row_groups[0]!.num_rows)

    const aligned = alignToRowGroups(part, groupRows + 10, groupRows + 20, 1_000_000)
    expect(aligned.start).toBe(groupRows)
  })
})
