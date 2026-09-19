import type { FileMetaData } from 'hyparquet'

const SPARK_SCHEMA_KEY = 'org.apache.spark.sql.parquet.row.metadata'

export interface SparkField {
  name: string
  type: unknown
  nullable: boolean
  metadata?: Record<string, unknown>
}

export interface SparkStructType {
  type: 'struct'
  fields: SparkField[]
}

/**
 * Spark writes its original StructType into the parquet footer. Recovering it
 * restores nullability and the logical Spark types (DecimalType, TimestampType)
 * that the physical parquet types alone cannot express.
 */
export function readSparkSchema(metadata: FileMetaData): SparkStructType | null {
  const entry = metadata.key_value_metadata?.find((kv) => kv.key === SPARK_SCHEMA_KEY)
  if (!entry?.value) return null

  try {
    const parsed: unknown = JSON.parse(entry.value)
    if (isStruct(parsed)) return parsed
  } catch {
    return null
  }
  return null
}

export function describeSparkType(type: unknown): string {
  if (typeof type === 'string') return type
  if (!type || typeof type !== 'object') return 'unknown'

  const node = type as Record<string, unknown>
  switch (node.type) {
    case 'struct':
      return `struct<${(node.fields as SparkField[] | undefined)?.length ?? 0} fields>`
    case 'array':
      return `array<${describeSparkType(node.elementType)}>`
    case 'map':
      return `map<${describeSparkType(node.keyType)}, ${describeSparkType(node.valueType)}>`
    case 'udt':
      return 'udt'
    default:
      return 'unknown'
  }
}

export function flattenSparkFields(schema: SparkStructType | null): Map<string, SparkField> {
  const byName = new Map<string, SparkField>()
  for (const field of schema?.fields ?? []) byName.set(field.name, field)
  return byName
}

function isStruct(value: unknown): value is SparkStructType {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as Record<string, unknown>).type === 'struct' &&
    Array.isArray((value as Record<string, unknown>).fields)
  )
}
