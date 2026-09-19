import type { SparkTable, TableColumn, TableWarning } from './types'
import { formatValue } from './format'

export interface ColumnChunkSummary {
  name: string
  physicalType: string
  codec: string
  encodings: string[]
  numValues: number
  compressedBytes: number
  uncompressedBytes: number
  nullCount: number | null
  min: string | null
  max: string | null
  hasBloomFilter: boolean
}

export interface RowGroupSummary {
  ordinal: number
  numRows: number
  compressedBytes: number
  uncompressedBytes: number
  columns: ColumnChunkSummary[]
}

export interface PartSummary {
  name: string
  relativePath: string
  byteLength: number
  rowCount: number
  firstRow: number
  partitions: Record<string, string | null>
  rowGroups: RowGroupSummary[]
}

export interface TableSummary {
  name: string
  columns: TableColumn[]
  partitionColumns: string[]
  parts: PartSummary[]
  totalRows: number
  totalBytes: number
  rowGroupCount: number
  createdBy: string | null
  warnings: TableWarning[]
  compressionRatio: number
}

/** The wire format: everything the UI and the legend need, with no live handles. */
export function summariseTable(table: SparkTable): TableSummary {
  const parts = table.parts.map<PartSummary>((part) => ({
    name: part.source.name,
    relativePath: part.source.relativePath,
    byteLength: part.source.byteLength,
    rowCount: part.rowCount,
    firstRow: part.firstRow,
    partitions: part.partitions,
    rowGroups: part.metadata.row_groups.map((group, ordinal) => ({
      ordinal,
      numRows: Number(group.num_rows),
      compressedBytes: Number(group.total_compressed_size ?? 0n),
      uncompressedBytes: Number(group.total_byte_size),
      columns: group.columns.map<ColumnChunkSummary>((chunk) => {
        const meta = chunk.meta_data
        return {
          name: meta?.path_in_schema.join('.') ?? '?',
          physicalType: meta?.type ?? '?',
          codec: meta?.codec ?? 'UNCOMPRESSED',
          encodings: meta?.encodings ?? [],
          numValues: Number(meta?.num_values ?? 0n),
          compressedBytes: Number(meta?.total_compressed_size ?? 0n),
          uncompressedBytes: Number(meta?.total_uncompressed_size ?? 0n),
          nullCount: meta?.statistics?.null_count === undefined ? null : Number(meta.statistics.null_count),
          min: statValue(meta?.statistics?.min_value ?? meta?.statistics?.min),
          max: statValue(meta?.statistics?.max_value ?? meta?.statistics?.max),
          hasBloomFilter: meta?.bloom_filter_offset !== undefined,
        }
      }),
    })),
  }))

  const uncompressed = parts.reduce(
    (sum, part) => sum + part.rowGroups.reduce((s, g) => s + g.uncompressedBytes, 0),
    0,
  )

  return {
    name: table.name,
    columns: table.columns,
    partitionColumns: table.partitionColumns,
    parts,
    totalRows: table.totalRows,
    totalBytes: table.totalBytes,
    rowGroupCount: table.rowGroupCount,
    createdBy: table.createdBy,
    warnings: table.warnings,
    compressionRatio: table.totalBytes > 0 ? uncompressed / table.totalBytes : 1,
  }
}

function statValue(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const text = formatValue(value)
  return text.length > 60 ? `${text.slice(0, 60)}...` : text
}
