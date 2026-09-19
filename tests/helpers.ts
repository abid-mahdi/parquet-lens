import { readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { asyncBufferFromFile } from 'hyparquet'
import type { SourceFile } from '../src/core/types'
import { isParquetFile } from '../src/core/sources'

export const FIXTURES = new URL('../fixtures/', import.meta.url).pathname

/** Node equivalent of the browser drop walker, so core tests need no browser. */
export async function fixtureSources(name: string): Promise<SourceFile[]> {
  const root = join(FIXTURES, name)
  const found: SourceFile[] = []

  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (isParquetFile(entry.name)) {
        const info = await stat(full)
        found.push({
          relativePath: `${name}/${relative(root, full)}`,
          name: entry.name,
          byteLength: info.size,
          open: () => asyncBufferFromFile(full),
        })
      }
    }
  }

  await walk(root)
  return found.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}
