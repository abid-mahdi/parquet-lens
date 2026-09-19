export interface CacheEntry<T> {
  value: T
  bytes: number
}

/** Bounded by approximate bytes so a multi-GB table cannot exhaust the tab. */
export class LruCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>()
  private currentBytes = 0

  constructor(private readonly maxBytes: number) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  set(key: string, value: T, bytes: number): void {
    const existing = this.entries.get(key)
    if (existing) {
      this.currentBytes -= existing.bytes
      this.entries.delete(key)
    }

    this.entries.set(key, { value, bytes })
    this.currentBytes += bytes

    while (this.currentBytes > this.maxBytes && this.entries.size > 1) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      const evicted = this.entries.get(oldest.value)
      this.entries.delete(oldest.value)
      this.currentBytes -= evicted?.bytes ?? 0
    }
  }

  clear(): void {
    this.entries.clear()
    this.currentBytes = 0
  }

  get size(): number {
    return this.entries.size
  }

  get bytes(): number {
    return this.currentBytes
  }
}
