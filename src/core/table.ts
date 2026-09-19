import { parquetMetadataAsync, parquetSchema } from 'hyparquet'
import type { FileMetaData, SchemaTree } from 'hyparquet'
import type { PartFile, SourceFile, SparkTable, TableColumn, TableWarning } from './types'
import { parsePartitionPath, partitionKeysInOrder } from './partitions'
import { describeSparkType, flattenSparkFields, readSparkSchema } from './sparkSchema'
import { describeLogicalType, schemaFingerprint, topLevelColumns } from './schema'
import { formatBytes } from './format'

const SMALL_FILE_BYTES = 16 * 1024 * 1024

export async function buildTable(name: string, sources: SourceFile[]): Promise<SparkTable> {
  if (sources.length === 0) throw new Error('No parquet files found')

  const ordered = [...sources].sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  const loaded = await Promise.all(
    ordered.map(async (source) => ({
      source,
      metadata: await parquetMetadataAsync(await source.open()),
    })),
  )

  const parts: PartFile[] = []
  let firstRow = 0
  for (const { source, metadata } of loaded) {
    const rowCount = Number(metadata.num_rows)
    parts.push({
      source,
      metadata,
      partitions: parsePartitionPath(source.relativePath),
      rowCount,
      firstRow,
    })
    firstRow += rowCount
  }

  const head = parts[0]
  if (!head) throw new Error('No parquet files found')

  const schema = parquetSchema(head.metadata)
  const partitionColumns = partitionKeysInOrder(ordered.map((s) => s.relativePath))
  const columns = buildColumns(schema, head.metadata, partitionColumns)

  return {
    name,
    parts,
    columns,
    partitionColumns,
    totalRows: firstRow,
    totalBytes: parts.reduce((sum, part) => sum + part.source.byteLength, 0),
    rowGroupCount: parts.reduce((sum, part) => sum + part.metadata.row_groups.length, 0),
    createdBy: head.metadata.created_by ?? null,
    warnings: collectWarnings(parts, schema),
  }
}

function buildColumns(
  schema: SchemaTree,
  metadata: FileMetaData,
  partitionColumns: string[],
): TableColumn[] {
  const sparkFields = flattenSparkFields(readSparkSchema(metadata))

  const fileColumns = topLevelColumns(schema).map<TableColumn>((node) => {
    const sparkField = sparkFields.get(node.element.name)
    return {
      name: node.element.name,
      path: node.path,
      origin: 'file',
      physicalType: node.element.type ?? null,
      logicalType: describeLogicalType(node.element),
      sparkType: sparkField ? describeSparkType(sparkField.type) : null,
      nullable: node.element.repetition_type !== 'REQUIRED',
      repeated: node.element.repetition_type === 'REPEATED',
    }
  })

  const partitionCols = partitionColumns.map<TableColumn>((name) => ({
    name,
    path: [name],
    origin: 'partition',
    physicalType: null,
    logicalType: 'directory value',
    sparkType: sparkFields.get(name) ? describeSparkType(sparkFields.get(name)?.type) : null,
    nullable: true,
    repeated: false,
  }))

  return [...fileColumns, ...partitionCols]
}

function collectWarnings(parts: PartFile[], schema: SchemaTree): TableWarning[] {
  const warnings: TableWarning[] = []
  const expected = schemaFingerprint(schema)

  for (const part of parts.slice(1)) {
    const actual = schemaFingerprint(parquetSchema(part.metadata))
    if (actual !== expected) {
      warnings.push({
        kind: 'schema-mismatch',
        message: `${part.source.name} has a different schema to the first part`,
        detail: `expected ${expected}\nfound    ${actual}`,
      })
      break
    }
  }

  if (parts.length > 1) {
    const averageBytes = parts.reduce((sum, p) => sum + p.source.byteLength, 0) / parts.length
    if (averageBytes < SMALL_FILE_BYTES) {
      warnings.push({
        kind: 'small-files',
        message: `${parts.length} parts averaging ${formatBytes(averageBytes)}`,
        detail: 'Spark targets around 128 MB per file. coalesce() or repartition() before writing.',
      })
    }
  }

  const head = parts[0]
  if (head && topLevelColumns(schema).some((c) => c.element.type === 'INT96')) {
    warnings.push({
      kind: 'legacy-timestamp',
      message: 'INT96 timestamps present',
      detail: 'Legacy Spark timestamp encoding. Newer readers expect INT64 TIMESTAMP_MICROS.',
    })
  }

  const hasStatistics = head?.metadata.row_groups.some((group) =>
    group.columns.some((column) => column.meta_data?.statistics),
  )
  if (head && !hasStatistics) {
    warnings.push({
      kind: 'no-statistics',
      message: 'No column statistics',
      detail: 'Without min/max statistics a reader cannot skip row groups, so every filter is a full scan.',
    })
  }

  return warnings
}

