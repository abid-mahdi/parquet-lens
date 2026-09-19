import { describe, expect, it } from 'vitest'
import { buildView, identityView, readByIndices } from '../../src/core/execute'
import { readRows } from '../../src/core/reader'
import { buildTable } from '../../src/core/table'
import { emptyQuery, withFilter } from '../../src/core/query'
import { fixtureSources } from '../helpers'

const multipart = await buildTable('multipart', await fixtureSources('multipart'))
const partitioned = await buildTable('partitioned', await fixtureSources('partitioned'))
const sorted = await buildTable('rg', await fixtureSources('manyrowgroups'))

describe('identity view', () => {
  it('reads nothing when there is no query', async () => {
    const view = await buildView(multipart, emptyQuery)
    expect(view.indices).toBeNull()
    expect(view.rowCount).toBe(multipart.totalRows)
    expect(view.stats.rowsScanned).toBe(0)
  })

  it('matches the helper', () => {
    expect(identityView(multipart).rowCount).toBe(multipart.totalRows)
  })
})

describe('filtering', () => {
  it('filters on a numeric column and matches a brute-force count', async () => {
    const query = withFilter(emptyQuery, { column: 'amount', op: 'gt', value: 1000 })
    const view = await buildView(multipart, query)

    const all = await readRows(multipart, 0, multipart.totalRows, ['amount'])
    const expected = all.filter((row) => (row.amount as number) > 1000).length

    expect(view.rowCount).toBe(expected)
    expect(view.stats.rowsMatched).toBe(expected)
  })

  it('returns rows that genuinely satisfy the predicate', async () => {
    const query = withFilter(emptyQuery, { column: 'amount', op: 'gt', value: 1000 })
    const view = await buildView(multipart, query)
    expect(view.indices).not.toBeNull()

    const rows = await readByIndices(view.indices!, 0, 25, ['amount'], (from, to, cols) =>
      readRows(multipart, from, to, cols),
    )
    expect(rows).toHaveLength(25)
    for (const row of rows) expect(row.amount as number).toBeGreaterThan(1000)
  })

  it('combines two filters with AND', async () => {
    let query = withFilter(emptyQuery, { column: 'amount', op: 'gt', value: 500 })
    query = withFilter(query, { column: 'region', op: 'eq', value: 'region_2' })
    const view = await buildView(multipart, query)

    const rows = await readByIndices(view.indices!, 0, Math.min(20, view.rowCount), ['amount', 'region'],
      (from, to, cols) => readRows(multipart, from, to, cols))
    for (const row of rows) {
      expect(row.amount as number).toBeGreaterThan(500)
      expect(row.region).toBe('region_2')
    }
  })

  it('handles a filter that matches nothing', async () => {
    const query = withFilter(emptyQuery, { column: 'amount', op: 'gt', value: 1e12 })
    const view = await buildView(multipart, query)
    expect(view.rowCount).toBe(0)
  })

  it('finds null rows with isNull', async () => {
    const nulls = await buildTable('nulls', await fixtureSources('nulls'))
    const view = await buildView(nulls, withFilter(emptyQuery, { column: 'name', op: 'isNull', value: null }))

    const rows = await readByIndices(view.indices!, 0, 10, ['name'], (from, to, cols) =>
      readRows(nulls, from, to, cols))
    for (const row of rows) expect(row.name).toBeNull()
  })
})

describe('predicate pushdown', () => {
  it('skips row groups whose statistics cannot match', async () => {
    const query = withFilter(emptyQuery, { column: 'bucket', op: 'lt', value: 5 })
    const view = await buildView(sorted, query)

    expect(view.stats.rowGroupsTotal).toBeGreaterThan(1)
    expect(view.stats.rowGroupsSkipped).toBeGreaterThan(0)
    expect(view.stats.rowsScanned).toBeLessThan(sorted.totalRows)
  })

  it('still returns the correct rows when groups were skipped', async () => {
    const query = withFilter(emptyQuery, { column: 'bucket', op: 'lt', value: 5 })
    const view = await buildView(sorted, query)

    const all = await readRows(sorted, 0, sorted.totalRows, ['bucket'])
    const expected = all.filter((row) => (row.bucket as number) < 5).length
    expect(view.rowCount).toBe(expected)
  })

  it('prunes whole partitions without reading any row group', async () => {
    const query = withFilter(emptyQuery, { column: 'year', op: 'eq', value: '2024' })
    const view = await buildView(partitioned, query)

    expect(view.stats.partitionsPruned).toBeGreaterThan(0)
    expect(view.stats.rowsScanned).toBe(0)

    const rows = await readByIndices(view.indices!, 0, 10, ['year'], (from, to, cols) =>
      readRows(partitioned, from, to, cols))
    for (const row of rows) expect(row.year).toBe('2024')
  })
})

describe('sorting', () => {
  it('orders rows ascending', async () => {
    const view = await buildView(multipart, { ...emptyQuery, sort: { column: 'amount', direction: 'asc' } })
    const rows = await readByIndices(view.indices!, 0, 40, ['amount'], (from, to, cols) =>
      readRows(multipart, from, to, cols))

    const amounts = rows.map((row) => row.amount as number)
    expect([...amounts].sort((a, b) => a - b)).toEqual(amounts)
  })

  it('orders rows descending', async () => {
    const view = await buildView(multipart, { ...emptyQuery, sort: { column: 'amount', direction: 'desc' } })
    const rows = await readByIndices(view.indices!, 0, 40, ['amount'], (from, to, cols) =>
      readRows(multipart, from, to, cols))

    const amounts = rows.map((row) => row.amount as number)
    expect([...amounts].sort((a, b) => b - a)).toEqual(amounts)
  })

  it('keeps every row when sorting without a filter', async () => {
    const view = await buildView(multipart, { ...emptyQuery, sort: { column: 'id', direction: 'asc' } })
    expect(view.rowCount).toBe(multipart.totalRows)
  })

  it('sorts the filtered set, not the whole table', async () => {
    const query = { ...withFilter(emptyQuery, { column: 'amount', op: 'gt', value: 900 }),
                    sort: { column: 'amount' as const, direction: 'asc' as const } }
    const view = await buildView(multipart, query)
    const rows = await readByIndices(view.indices!, 0, 20, ['amount'], (from, to, cols) =>
      readRows(multipart, from, to, cols))

    for (const row of rows) expect(row.amount as number).toBeGreaterThan(900)
    const amounts = rows.map((r) => r.amount as number)
    expect([...amounts].sort((a, b) => a - b)).toEqual(amounts)
  })
})

describe('cancellation', () => {
  it('aborts a running query', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      buildView(multipart, withFilter(emptyQuery, { column: 'amount', op: 'gt', value: 1 }), {
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled/i)
  })
})

describe('gathering scattered rows', () => {
  it('batches contiguous runs and preserves requested order', async () => {
    const indices = Int32Array.from([5, 6, 7, 100, 101, 3])
    const reads: Array<[number, number]> = []

    const rows = await readByIndices(indices, 0, 6, ['id'], async (from, to, cols) => {
      reads.push([from, to])
      return readRows(multipart, from, to, cols)
    })

    expect(reads).toHaveLength(3)
    expect(rows).toHaveLength(6)
  })
})
