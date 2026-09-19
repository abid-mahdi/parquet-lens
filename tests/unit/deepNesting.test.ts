import { describe, expect, it } from 'vitest'
import { readRows } from '../../src/core/reader'
import { buildTable } from '../../src/core/table'
import { fixtureSources } from '../helpers'

const table = await buildTable('deep', await fixtureSources('deep-nested'))
const rows = await readRows(table, 0, 300, undefined)
const byId = new Map(rows.map((row) => [row.id as number, row]))
const row = (id: number) => byId.get(id) as Record<string, any>

describe('deeply nested schema', () => {
  it('exposes every top-level column', () => {
    expect(table.columns.map((c) => c.name)).toEqual([
      'id', 'deep', 'matrix', 'index', 'tree', 'nestedMap', 'arrayOfMap',
    ])
  })

  it('reads all 300 rows', () => {
    expect(rows).toHaveLength(300)
    expect(byId.size).toBe(300)
  })
})

describe('five levels of struct', () => {
  it('reassembles the full chain down to the leaf', () => {
    expect(row(1).deep).toEqual({ l2: { l3: { l4: { leaf: { value: 'deep_1', n: 1 } } } } })
  })

  it('preserves a null at the top of the chain', () => {
    expect(row(5).deep).toBeNull()
  })

  it('preserves a null at the deepest level while keeping the chain', () => {
    expect(row(7).deep).toEqual({ l2: { l3: { l4: { leaf: null } } } })
  })
})

describe('array of array of array', () => {
  it('keeps all three levels distinct', () => {
    expect(row(1).matrix).toEqual([[[1, 2], [3]], [[10], []]])
  })

  it('preserves a null inner array', () => {
    expect(row(3).matrix).toEqual([[[3, 4], null], [[30], []]])
  })

  it('preserves an empty array distinctly from null', () => {
    const m = row(1).matrix as unknown[][][]
    expect(m[1]?.[1]).toEqual([])
    expect(m[1]?.[1]).not.toBeNull()
  })

  it('preserves a null middle array', () => {
    expect(row(4).matrix).toEqual([[[4, 5], [6]], null])
  })
})

describe('map to array to struct to array', () => {
  it('reassembles values through every level', () => {
    expect(row(1).index).toEqual({
      a: [{ k: 'k1', v: [1.5, 2.5] }, { k: null, v: null }],
      b: [{ k: 'b1', v: [] }],
    })
  })

  it('preserves a null map value', () => {
    expect((row(6).index as Record<string, unknown>).b).toBeNull()
  })
})

describe('array of struct of array of struct of struct', () => {
  it('reassembles the tree', () => {
    expect(row(1).tree).toEqual([
      { name: 'root_1', children: [
        { name: 'child_1_1', leaf: { x: 1 } },
        { name: 'child_1_2', leaf: { x: 2 } },
      ] },
      { name: 'root2_1', children: [] },
    ])
  })

  it('preserves a null struct nested inside an array inside a struct', () => {
    const tree = row(8).tree as Array<{ children: Array<{ leaf: unknown }> }>
    expect(tree[0]?.children[1]?.leaf).toBeNull()
  })
})

describe('map of map and array of map', () => {
  it('reads a nested map', () => {
    expect(row(1).nestedMap).toEqual({ outer: { inner: 1, other: 3 } })
  })

  it('reads an array of maps including a null entry', () => {
    expect(row(10).arrayOfMap).toEqual([{ x: 'v10' }, null])
  })
})

describe('null distribution is actually exercised', () => {
  it('has nulls at every column, so the assertions above are not vacuous', () => {
    const nullCounts = Object.fromEntries(
      table.columns.map((c) => [c.name, rows.filter((r) => r[c.name] === null).length]),
    )
    expect(nullCounts.deep).toBeGreaterThan(0)
    expect(nullCounts.matrix).toBeGreaterThan(0)
    expect(nullCounts.index).toBeGreaterThan(0)
    expect(nullCounts.tree).toBeGreaterThan(0)
    expect(nullCounts.nestedMap).toBeGreaterThan(0)
    expect(nullCounts.arrayOfMap).toBeGreaterThan(0)
    expect(nullCounts.id).toBe(0)
  })
})
