const HIVE_DEFAULT = '__HIVE_DEFAULT_PARTITION__'
const SEGMENT = /^([^=/]+)=(.*)$/

/**
 * Hive-style partition values live in directory names, never inside the parquet
 * file, so they have to be recovered from the path or the columns vanish.
 */
export function parsePartitionPath(relativePath: string): Record<string, string | null> {
  const partitions: Record<string, string | null> = {}
  const segments = relativePath.split('/').slice(0, -1)

  for (const segment of segments) {
    const match = SEGMENT.exec(segment)
    if (!match) continue
    const [, key, rawValue] = match
    if (!key) continue
    const value = decodeURIComponent(rawValue ?? '')
    partitions[key] = value === HIVE_DEFAULT ? null : value
  }
  return partitions
}

export function partitionKeysInOrder(paths: string[]): string[] {
  const seen: string[] = []
  for (const path of paths) {
    for (const segment of path.split('/').slice(0, -1)) {
      const match = SEGMENT.exec(segment)
      const key = match?.[1]
      if (key && !seen.includes(key)) seen.push(key)
    }
  }
  return seen
}
