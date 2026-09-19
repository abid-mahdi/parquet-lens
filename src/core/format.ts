export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '-'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') return value
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value)
  if (typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Uint8Array) return `0x${[...value.slice(0, 8)].map(hex).join('')}${value.length > 8 ? '...' : ''}`
  try {
    return JSON.stringify(value, jsonSafe)
  } catch {
    return String(value)
  }
}

export function jsonSafe(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Uint8Array) return [...value]
  return value
}

export function isComplex(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !(value instanceof Date) && !(value instanceof Uint8Array)
}

function hex(byte: number): string {
  return byte.toString(16).padStart(2, '0')
}
