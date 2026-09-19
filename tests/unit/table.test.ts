import { describe, expect, it } from 'vitest'
import { buildTable } from '../../src/core/table'
import { fixtureSources } from '../helpers'

describe('buildTable', () => {
  it('reads a single-part table', async () => {
    const table = await buildTable('simple', await fixtureSources('simple'))
    expect(table.parts).toHaveLength(1)
    expect(table.totalRows).toBe(1000)
    expect(table.columns.map((c) => c.name)).toEqual(['id', 'name', 'amount', 'active', 'created_on'])
    expect(table.createdBy).toMatch(/parquet-mr/)
  })

  it('collapses 8 Spark part files into one logical table', async () => {
    const sources = await fixtureSources('multipart')
    expect(sources).toHaveLength(8)

    const table = await buildTable('multipart', sources)
    expect(table.parts).toHaveLength(8)
    expect(table.totalRows).toBe(40000)
    expect(table.parts.reduce((sum, p) => sum + p.rowCount, 0)).toBe(40000)
  })

  it('assigns contiguous non-overlapping row offsets across parts', async () => {
    const table = await buildTable('multipart', await fixtureSources('multipart'))
    let expected = 0
    for (const part of table.parts) {
      expect(part.firstRow).toBe(expected)
      expected += part.rowCount
    }
    expect(expected).toBe(table.totalRows)
  })

  it('recovers partition columns that exist only as directory names', async () => {
    const table = await buildTable('partitioned', await fixtureSources('partitioned'))
    expect(table.partitionColumns).toEqual(['year', 'month'])

    const partitionCols = table.columns.filter((c) => c.origin === 'partition')
    expect(partitionCols.map((c) => c.name)).toEqual(['year', 'month'])

    const fileCols = table.columns.filter((c) => c.origin === 'file').map((c) => c.name)
    expect(fileCols).toEqual(['id', 'event', 'value'])
    expect(fileCols).not.toContain('year')
  })

  it('recovers the original Spark types from the footer', async () => {
    const table = await buildTable('decimals', await fixtureSources('decimals'))
    const price = table.columns.find((c) => c.name === 'price')
    expect(price?.sparkType).toBe('decimal(18,4)')
    expect(price?.logicalType).toBe('DECIMAL(18, 4)')
  })

  it('exposes nested struct, array and map columns', async () => {
    const table = await buildTable('nested', await fixtureSources('nested'))
    expect(table.columns.map((c) => c.name)).toEqual(['id', 'profile', 'tags', 'attrs', 'orders'])
  })

  it('handles a zero-row table without throwing', async () => {
    const table = await buildTable('empty', await fixtureSources('empty'))
    expect(table.totalRows).toBe(0)
    expect(table.columns.length).toBeGreaterThan(0)
  })

  it('rejects an empty source list', async () => {
    await expect(buildTable('none', [])).rejects.toThrow(/no parquet files/i)
  })
})

describe('warnings', () => {
  it('flags parts whose schema disagrees instead of crashing', async () => {
    const table = await buildTable('schema-mismatch', await fixtureSources('schema-mismatch'))
    const warning = table.warnings.find((w) => w.kind === 'schema-mismatch')
    expect(warning).toBeDefined()
    expect(warning?.message).toMatch(/different schema/)
  })

  it('flags the Spark small-file problem', async () => {
    const table = await buildTable('multipart', await fixtureSources('multipart'))
    expect(table.warnings.some((w) => w.kind === 'small-files')).toBe(true)
  })

  it('flags legacy INT96 timestamps', async () => {
    const table = await buildTable('int96', await fixtureSources('timestamps-int96'))
    expect(table.warnings.some((w) => w.kind === 'legacy-timestamp')).toBe(true)
  })

  it('does not flag INT96 for modern timestamp tables', async () => {
    const table = await buildTable('micros', await fixtureSources('timestamps-micros'))
    expect(table.warnings.some((w) => w.kind === 'legacy-timestamp')).toBe(false)
  })
})
