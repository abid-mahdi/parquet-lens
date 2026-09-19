import { useCallback, useEffect, useRef, useState } from 'react'
import { emptyQuery, isEmpty } from '../core/query'
import type { Query } from '../core/query'
import type { ViewStats } from '../core/execute'
import type { ParquetClient } from '../worker/client'

export interface TableQuery {
  query: Query
  update: (change: (current: Query) => Query) => void
  reset: () => void
  rowCount: number
  stats: ViewStats | null
  running: boolean
  progress: number
  /** Advances on every applied query, including ones that only change row order. */
  version: number
}

export function useTableQuery(
  client: ParquetClient | null,
  totalRows: number,
  onError: (message: string) => void,
): TableQuery {
  const [query, setQuery] = useState<Query>(emptyQuery)
  const [rowCount, setRowCount] = useState(totalRows)
  const [stats, setStats] = useState<ViewStats | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [version, setVersion] = useState(0)
  const run = useRef(0)

  useEffect(() => {
    setQuery(emptyQuery)
    setStats(null)
    setRowCount(totalRows)
  }, [client, totalRows])

  useEffect(() => {
    if (!client) return

    const current = ++run.current
    setRunning(true)
    setProgress(0)

    client
      .applyQuery(query, (fraction) => {
        if (run.current === current) setProgress(fraction)
      })
      .then((result) => {
        if (run.current !== current) return
        setRowCount(result.rowCount)
        setStats(isEmpty(query) ? null : result.stats)
        setVersion((previous) => previous + 1)
      })
      .catch((cause: unknown) => {
        if (run.current === current) {
          onError(cause instanceof Error ? cause.message : String(cause))
        }
      })
      .finally(() => {
        if (run.current === current) setRunning(false)
      })
  }, [client, query, onError])

  const update = useCallback((change: (current: Query) => Query) => {
    setQuery(change)
  }, [])

  const reset = useCallback(() => setQuery(emptyQuery), [])

  return { query, update, reset, rowCount, stats, running, progress, version }
}
