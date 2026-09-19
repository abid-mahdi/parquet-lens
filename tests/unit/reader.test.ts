import { describe, expect, it } from 'vitest'
import { readRows } from '../../src/core/reader'
import { buildTable } from '../../src/core/table'
import { fixtureSources } from '../helpers'

describe('readRows', () => {
  it('reads a window from a single part', async () => {
    const table = await buildTable('simple', await fixtureSources('simple'))
    const rows = await readRows(table, 0, 5, undefined)

    expect(rows).toHaveLength(5)
    expect(rows[0]).toMatchObject({ id: 1, name: 'user_1', active: false })
    expect(rows[4]).toMatchObject({ id: 5, name: 'user_5' })
  })

  it('reads a window spanning a part boundary', async () => {
    const table = await buildTable('multipart', await fixtureSources('multipart'))
    const boundary = table.parts[0]!.rowCount
    const rows = await readRows(table, boundary - 3, boundary + 3, undefined)

    expect(rows).toHaveLength(6)
    expect(rows.every((row) => typeof row.id === 'number')).toBe(true)
  })

  it('returns every row exactly once across the whole table', async () => {
    const table = await buildTable('multipart', await fixtureSources('multipart'))
    const rows = await readRows(table, 0, table.totalRows, ['id'])

    expect(rows).toHaveLength(40000)
    const ids = new Set(rows.map((row) => row.id as number))
    expect(ids.size).toBe(40000)
  })

  it('injects partition values that are absent from the parquet data', async () => {
    const table = await buildTable('partitioned', await fixtureSources('partitioned'))
    const rows = await readRows(table, 0, 3, undefined)

    for (const row of rows) {
      expect(row.year).toMatch(/^202[34]$/)
      expect(row.month).toMatch(/^[1-6]$/)
      expect(row.id).toBeTypeOf('number')
    }
  })

  it('honours column projection', async () => {
    const table = await buildTable('simple', await fixtureSources('simple'))
    const rows = await readRows(table, 0, 2, ['id', 'name'])

    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(['id', 'name'])
  })

  it('clamps a window that runs past the end of the table', async () => {
    const table = await buildTable('simple', await fixtureSources('simple'))
    expect(await readRows(table, 995, 2000, ['id'])).toHaveLength(5)
    expect(await readRows(table, 5000, 6000, ['id'])).toHaveLength(0)
  })

  it('aborts an in-flight read', async () => {
    const table = await buildTable('multipart', await fixtureSources('multipart'))
    const controller = new AbortController()
    controller.abort()

    await expect(readRows(table, 0, 1000, undefined, { signal: controller.signal })).rejects.toThrow(
      /cancelled/i,
    )
  })
})

describe('compression codecs', () => {
  it('reads zstd, the codec Spark uses when tuned for size', async () => {
    const table = await buildTable('zstd', await fixtureSources('zstd'))
    const rows = await readRows(table, 0, 3, ['id', 'payload'])
    expect(rows).toHaveLength(3)
    expect(rows[0]?.payload).toMatch(/^payload_1/)
  })

  it('reads gzip', async () => {
    const table = await buildTable('gzip', await fixtureSources('gzip'))
    const rows = await readRows(table, 0, 3, ['id'])
    expect(rows[0]?.id).toBe(1)
  })
})

describe('nested types', () => {
  it('returns structs, arrays and maps as usable values', async () => {
    const table = await buildTable('nested', await fixtureSources('nested'))
    const rows = await readRows(table, 0, 1, undefined)
    const row = rows[0]!

    expect(row.profile).toMatchObject({ first: 'First1', last: 'Last1' })
    expect(row.tags).toEqual(['tag1', 'tag1'])
    expect(row.attrs).toMatchObject({ env: 'dev' })
    expect(Array.isArray(row.orders)).toBe(true)
  })
})

describe('nulls', () => {
  it('preserves nulls rather than coercing them', async () => {
    const table = await buildTable('nulls', await fixtureSources('nulls'))
    const rows = await readRows(table, 0, 12, undefined)

    expect(rows[2]?.name).toBeNull()
    expect(rows[3]?.amount).toBeNull()
  })
})

describe('schema mismatch between parts', () => {
  it('reads every row, filling columns a part does not have with null', async () => {
    const table = await buildTable('mismatch', await fixtureSources('schema-mismatch'))
    const rows = await readRows(table, 0, table.totalRows, ['id', 'name'])

    expect(rows).toHaveLength(200)
    expect(rows.every((row) => row !== undefined)).toBe(true)

    const named = rows.filter((row) => row.name !== null)
    const unnamed = rows.filter((row) => row.name === null)
    expect(named).toHaveLength(100)
    expect(unnamed).toHaveLength(100)
  })

  it('reads the mismatched part without a column projection', async () => {
    const table = await buildTable('mismatch', await fixtureSources('schema-mismatch'))
    const rows = await readRows(table, 100, 105, undefined)
    expect(rows).toHaveLength(5)
  })
})
