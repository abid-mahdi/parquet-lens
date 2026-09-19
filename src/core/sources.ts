import type { SourceFile } from './types'

export function isParquetFile(name: string): boolean {
  const base = name.split('/').pop() ?? name
  if (base.startsWith('.') || base.startsWith('_')) return false
  return base.endsWith('.parquet') || base.endsWith('.parq')
}

export function fileSource(file: File, relativePath: string): SourceFile {
  return {
    relativePath,
    name: file.name,
    byteLength: file.size,
    open: async () => ({
      byteLength: file.size,
      slice: (start: number, end?: number) => file.slice(start, end).arrayBuffer(),
    }),
  }
}

/** Spark writes a directory, so a drop has to be walked rather than read flat. */
export async function sourcesFromDataTransfer(items: DataTransferItemList): Promise<SourceFile[]> {
  const entries: FileSystemEntry[] = []
  for (const item of Array.from(items)) {
    const entry = item.webkitGetAsEntry?.()
    if (entry) entries.push(entry)
  }

  const collected: SourceFile[] = []
  await Promise.all(entries.map((entry) => walkEntry(entry, '', collected)))
  return collected
}

export function sourcesFromFileList(files: FileList): SourceFile[] {
  return Array.from(files)
    .filter((file) => isParquetFile(file.name))
    .map((file) => fileSource(file, file.webkitRelativePath || file.name))
}

export function tableNameFor(sources: SourceFile[], fallback: string): string {
  const first = sources[0]
  if (!first) return fallback
  const segments = first.relativePath.split('/')
  return segments.length > 1 ? (segments[0] ?? fallback) : first.name.replace(/\.parq(uet)?$/, '')
}

async function walkEntry(entry: FileSystemEntry, prefix: string, out: SourceFile[]): Promise<void> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name

  if (entry.isFile) {
    if (!isParquetFile(entry.name)) return
    const file = await readEntryFile(entry as FileSystemFileEntry)
    out.push(fileSource(file, path))
    return
  }

  if (entry.isDirectory) {
    const children = await readEntryDirectory(entry as FileSystemDirectoryEntry)
    await Promise.all(children.map((child) => walkEntry(child, path, out)))
  }
}

function readEntryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

/** readEntries returns at most 100 per call, so it has to be drained. */
async function readEntryDirectory(entry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = entry.createReader()
  const all: FileSystemEntry[] = []

  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    )
    if (batch.length === 0) return all
    all.push(...batch)
  }
}
