import type { AsyncBuffer, FileMetaData, ParquetType } from 'hyparquet'

/** A parquet part file, addressable from either the browser or Node. */
export interface SourceFile {
  relativePath: string
  name: string
  byteLength: number
  open(): Promise<AsyncBuffer>
}

export interface PartFile {
  source: SourceFile
  metadata: FileMetaData
  partitions: Record<string, string | null>
  rowCount: number
  firstRow: number
}

export type ColumnOrigin = 'file' | 'partition'

export interface TableColumn {
  name: string
  path: string[]
  origin: ColumnOrigin
  physicalType: ParquetType | null
  logicalType: string | null
  sparkType: string | null
  nullable: boolean
  repeated: boolean
}

export interface TableWarning {
  kind: 'schema-mismatch' | 'small-files' | 'legacy-timestamp' | 'no-statistics'
  message: string
  detail?: string
}

export interface SparkTable {
  name: string
  parts: PartFile[]
  columns: TableColumn[]
  partitionColumns: string[]
  totalRows: number
  totalBytes: number
  rowGroupCount: number
  createdBy: string | null
  warnings: TableWarning[]
}

export interface RowWindow {
  start: number
  end: number
  columns: string[]
}

export type CellValue = string | number | bigint | boolean | null | object
export type Row = Record<string, CellValue>
