import { describe, expect, it } from 'vitest'
import { parsePartitionPath, partitionKeysInOrder } from '../../src/core/partitions'

describe('parsePartitionPath', () => {
  it('reads Hive-style key=value directories', () => {
    expect(parsePartitionPath('t/year=2024/month=06/part-0.parquet')).toEqual({
      year: '2024',
      month: '06',
    })
  })

  it('ignores the file name itself', () => {
    expect(parsePartitionPath('t/part-0.parquet')).toEqual({})
  })

  it('url-decodes values', () => {
    expect(parsePartitionPath('t/region=eu%2Fwest/part-0.parquet')).toEqual({ region: 'eu/west' })
  })

  it('maps the Hive default sentinel to null', () => {
    expect(parsePartitionPath('t/dt=__HIVE_DEFAULT_PARTITION__/p.parquet')).toEqual({ dt: null })
  })

  it('keeps partition key order stable across paths', () => {
    expect(
      partitionKeysInOrder(['t/year=2024/month=1/a.parquet', 't/year=2023/month=2/b.parquet']),
    ).toEqual(['year', 'month'])
  })
})
