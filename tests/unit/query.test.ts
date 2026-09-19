import { describe, expect, it } from 'vitest'
import {
  compareForSort, cycleSort, describePredicate, emptyQuery, isEmpty, literal,
  matches, sparkCode, sparkPredicate, toggleSelected, withFilter, withoutFilter,
} from '../../src/core/query'
import type { Predicate, Query } from '../../src/core/query'
import type { TableColumn } from '../../src/core/types'

const columns: TableColumn[] = [
  { name: 'id', path: ['id'], origin: 'file', physicalType: 'INT32', logicalType: null, sparkType: 'integer', nullable: false, repeated: false },
  { name: 'amount', path: ['amount'], origin: 'file', physicalType: 'DOUBLE', logicalType: null, sparkType: 'double', nullable: true, repeated: false },
  { name: 'year', path: ['year'], origin: 'partition', physicalType: null, logicalType: null, sparkType: null, nullable: true, repeated: false },
]

const options = { tableName: 'events', path: 'events', columns, partitionColumns: ['year'] }

describe('query state', () => {
  it('starts empty', () => {
    expect(isEmpty(emptyQuery)).toBe(true)
  })

  it('toggles a column into and out of the selection', () => {
    const selected = toggleSelected(emptyQuery, 'id')
    expect(selected.select).toEqual(['id'])
    expect(toggleSelected(selected, 'id').select).toEqual([])
  })

  it('replaces a filter on the same column and operator rather than stacking', () => {
    let query = withFilter(emptyQuery, { column: 'amount', op: 'gt', value: 10 })
    query = withFilter(query, { column: 'amount', op: 'gt', value: 50 })
    expect(query.filters).toHaveLength(1)
    expect(query.filters[0]?.value).toBe(50)
  })

  it('keeps distinct operators on the same column', () => {
    let query = withFilter(emptyQuery, { column: 'amount', op: 'gt', value: 10 })
    query = withFilter(query, { column: 'amount', op: 'lt', value: 90 })
    expect(query.filters).toHaveLength(2)
  })

  it('removes a filter by index', () => {
    let query = withFilter(emptyQuery, { column: 'a', op: 'eq', value: 1 })
    query = withFilter(query, { column: 'b', op: 'eq', value: 2 })
    expect(withoutFilter(query, 0).filters.map((f) => f.column)).toEqual(['b'])
  })

  it('cycles sort asc, desc, then off', () => {
    const asc = cycleSort(emptyQuery, 'amount')
    expect(asc.sort).toEqual({ column: 'amount', direction: 'asc' })
    const desc = cycleSort(asc, 'amount')
    expect(desc.sort).toEqual({ column: 'amount', direction: 'desc' })
    expect(cycleSort(desc, 'amount').sort).toBeNull()
  })

  it('switching column restarts the sort ascending', () => {
    const desc = cycleSort(cycleSort(emptyQuery, 'amount'), 'amount')
    expect(cycleSort(desc, 'id').sort).toEqual({ column: 'id', direction: 'asc' })
  })
})

describe('spark code generation', () => {
  it('renders a bare read when nothing is selected', () => {
    const code = sparkCode(emptyQuery, options)
    expect(code).toContain('val events = spark.read.parquet("events")')
    expect(code).toContain('.show(20, truncate = false)')
    expect(code).not.toContain('.filter')
    expect(code).not.toContain('.select')
  })

  it('renders select, filter and orderBy in Spark order', () => {
    const query: Query = {
      ...emptyQuery,
      select: ['id', 'amount'],
      filters: [{ column: 'amount', op: 'gt', value: 100 }],
      sort: { column: 'amount', direction: 'desc' },
    }
    const code = sparkCode(query, options)
    expect(code).toContain('.filter($"amount" > 100)')
    expect(code).toContain('.select($"id", $"amount")')
    expect(code).toContain('.orderBy($"amount".desc)')
    expect(code.indexOf('.filter')).toBeLessThan(code.indexOf('.select'))
  })

  it('marks a partition filter as pruning directories', () => {
    const query = withFilter(emptyQuery, { column: 'year', op: 'eq', value: '2024' })
    const code = sparkCode(query, options)
    expect(code).toContain('.filter($"year" === "2024")')
    expect(code).toContain('prunes whole directories')
  })

  it('puts partition filters before data filters', () => {
    let query = withFilter(emptyQuery, { column: 'amount', op: 'gt', value: 1 })
    query = withFilter(query, { column: 'year', op: 'eq', value: '2024' })
    const code = sparkCode(query, options)
    expect(code.indexOf('$"year"')).toBeLessThan(code.indexOf('$"amount"'))
  })

  it('reads a single part when scoped', () => {
    const query = { ...emptyQuery, scopedPart: 0 }
    const code = sparkCode(query, { ...options, partPath: 'events/part-00000.parquet' })
    expect(code).toContain('val part = spark.read.parquet("events/part-00000.parquet")')
    expect(code).toContain('a single Spark task reads')
  })

  it('honours an explicit limit', () => {
    expect(sparkCode({ ...emptyQuery, limit: 5 }, options)).toContain('.show(5, truncate = false)')
  })
})

describe('spark literals and predicates', () => {
  it('quotes strings and escapes embedded quotes', () => {
    expect(literal('hi')).toBe('"hi"')
    expect(literal('say "hi"')).toBe('"say \\"hi\\""')
  })

  it('suffixes bigints with L', () => {
    expect(literal(10n)).toBe('10L')
  })

  it('leaves numbers and booleans bare', () => {
    expect(literal(1.5)).toBe('1.5')
    expect(literal(true)).toBe('true')
  })

  it('renders null checks as Spark method calls', () => {
    expect(sparkPredicate({ column: 'a', op: 'isNull', value: null })).toBe('$"a".isNull')
    expect(sparkPredicate({ column: 'a', op: 'notNull', value: null })).toBe('$"a".isNotNull')
  })

  it('renders contains', () => {
    expect(sparkPredicate({ column: 'a', op: 'contains', value: 'x' })).toBe('$"a".contains("x")')
  })

  it('describes a predicate for the UI chip', () => {
    expect(describePredicate({ column: 'a', op: 'gte', value: 3 })).toBe('a >= 3')
  })
})

describe('predicate evaluation', () => {
  const cases: Array<[Predicate, unknown, boolean]> = [
    [{ column: 'a', op: 'eq', value: 5 }, 5, true],
    [{ column: 'a', op: 'eq', value: 5 }, 6, false],
    [{ column: 'a', op: 'ne', value: 5 }, 6, true],
    [{ column: 'a', op: 'gt', value: 5 }, 6, true],
    [{ column: 'a', op: 'gt', value: 5 }, 5, false],
    [{ column: 'a', op: 'gte', value: 5 }, 5, true],
    [{ column: 'a', op: 'lt', value: 5 }, 4, true],
    [{ column: 'a', op: 'lte', value: 5 }, 5, true],
    [{ column: 'a', op: 'contains', value: 'ell' }, 'hello', true],
    [{ column: 'a', op: 'contains', value: 'ELL' }, 'hello', true],
    [{ column: 'a', op: 'isNull', value: null }, null, true],
    [{ column: 'a', op: 'isNull', value: null }, 1, false],
    [{ column: 'a', op: 'notNull', value: null }, 1, true],
  ]

  for (const [predicate, value, expected] of cases) {
    it(`${describePredicate(predicate)} against ${JSON.stringify(value)} is ${expected}`, () => {
      expect(matches(predicate, value as never)).toBe(expected)
    })
  }

  it('never matches a null against a comparison operator', () => {
    expect(matches({ column: 'a', op: 'gt', value: 0 }, null)).toBe(false)
    expect(matches({ column: 'a', op: 'eq', value: 0 }, null)).toBe(false)
  })

  it('compares bigints without precision loss', () => {
    const huge = 9007199254740993n
    expect(matches({ column: 'a', op: 'eq', value: huge }, huge)).toBe(true)
    expect(matches({ column: 'a', op: 'gt', value: 9007199254740992n }, huge)).toBe(true)
  })
})

describe('sort ordering', () => {
  it('sorts nulls last ascending, matching Spark', () => {
    const values = [3, null, 1, 2]
    expect([...values].sort((a, b) => compareForSort(a, b, 'asc'))).toEqual([1, 2, 3, null])
  })

  it('keeps nulls last descending too', () => {
    const values = [3, null, 1, 2]
    expect([...values].sort((a, b) => compareForSort(a, b, 'desc'))).toEqual([3, 2, 1, null])
  })

  it('sorts strings lexicographically', () => {
    expect(['b', 'a', 'c'].sort((a, b) => compareForSort(a, b, 'asc'))).toEqual(['a', 'b', 'c'])
  })
})
