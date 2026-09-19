/**
 * hyparquet yields `undefined` for a null inside a nested value. JSON.stringify
 * then drops the key entirely, so an explicitly-null struct field silently
 * disappears from view. Spark wrote null, so null is what gets shown.
 */
export function normalizeNulls(value: unknown): unknown {
  if (value === undefined) return null
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Date || value instanceof Uint8Array) return value

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = normalizeNulls(value[i])
    return value
  }

  if (value instanceof Map) {
    for (const [key, entry] of value) value.set(key, normalizeNulls(entry))
    return value
  }

  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) record[key] = normalizeNulls(record[key])
  return record
}
