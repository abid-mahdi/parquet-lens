import { useCallback, useEffect, useState } from 'react'
import { ParquetClient } from '../worker/client'
import { tableNameFor } from '../core/sources'
import type { TableSummary } from '../core/summary'
import type { SourceFile } from '../core/types'

export interface ParquetTable {
  client: ParquetClient | null
  summary: TableSummary | null
  error: string | null
  opening: boolean
  open: (sources: SourceFile[]) => Promise<void>
  close: () => void
  reportError: (message: string) => void
}

/** Owns the worker lifecycle: one client per open table, terminated on replace. */
export function useParquetTable(): ParquetTable {
  const [client, setClient] = useState<ParquetClient | null>(null)
  const [summary, setSummary] = useState<TableSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)

  useEffect(() => () => client?.terminate(), [client])

  const open = useCallback(async (sources: SourceFile[]) => {
    if (sources.length === 0) {
      setError('No .parquet files found in that drop. Spark writes them inside a directory.')
      return
    }

    setOpening(true)
    setError(null)
    setSummary(null)

    const next = new ParquetClient()
    try {
      const files = await Promise.all(
        sources.map(async (source) => ({
          file: await asFile(source),
          relativePath: source.relativePath,
        })),
      )
      const opened = await next.open(tableNameFor(sources, 'df'), files)
      setClient((previous) => {
        previous?.terminate()
        return next
      })
      setSummary(opened)
    } catch (cause) {
      next.terminate()
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setOpening(false)
    }
  }, [])

  const close = useCallback(() => {
    setClient((previous) => {
      previous?.terminate()
      return null
    })
    setSummary(null)
    setError(null)
  }, [])

  return { client, summary, error, opening, open, close, reportError: setError }
}

/** Browser sources already hold a transferable File; anything else is materialised. */
async function asFile(source: SourceFile): Promise<File> {
  const withFile = source as SourceFile & { file?: File }
  if (withFile.file) return withFile.file

  const buffer = await source.open()
  return new File([await buffer.slice(0, buffer.byteLength)], source.name)
}
