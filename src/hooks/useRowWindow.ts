import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Row } from '../core/types'
import type { ParquetClient } from '../worker/client'

const BLOCK_ROWS = 256
const PREFETCH_BLOCKS = 1
const MAX_CACHED_BLOCKS = 240

export interface RowWindow {
  getRow(index: number): Row | undefined
  requestRange(start: number, end: number): void
  loadedBlocks: number
  pendingBlocks: number
  error: string | null
}

/**
 * Rendering never waits on a decode: visible rows come from cache or render as
 * skeletons, and only the settled viewport triggers a fetch. Superseded requests
 * are dropped by generation so a fast scroll cannot queue a backlog.
 */
export function useRowWindow(
  client: ParquetClient | null,
  totalRows: number,
  columns: string[] | undefined,
): RowWindow {
  const blocks = useRef(new Map<number, Row[]>()).current
  const inFlight = useRef(new Set<number>()).current
  const order = useRef<number[]>([]).current
  const generation = useRef(0)
  const scheduled = useRef<number | null>(null)
  const target = useRef<{ start: number; end: number }>({ start: 0, end: 0 })

  const [version, setVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const columnKey = columns?.join(',') ?? '*'

  useEffect(() => {
    blocks.clear()
    inFlight.clear()
    order.length = 0
    generation.current++
    setVersion((v) => v + 1)
  }, [client, columnKey, blocks, inFlight, order])

  const fetchBlock = useCallback(
    async (block: number, currentGeneration: number) => {
      if (!client || blocks.has(block) || inFlight.has(block)) return
      inFlight.add(block)

      const start = block * BLOCK_ROWS
      const end = Math.min(start + BLOCK_ROWS, totalRows)

      try {
        const rows = await client.rows(start, end, columns)
        if (generation.current !== currentGeneration) return

        blocks.set(block, rows)
        order.push(block)
        while (order.length > MAX_CACHED_BLOCKS) {
          const evicted = order.shift()
          if (evicted !== undefined && evicted !== block) blocks.delete(evicted)
        }
        setVersion((v) => v + 1)
      } catch (cause) {
        if (generation.current === currentGeneration) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      } finally {
        inFlight.delete(block)
      }
    },
    [client, columns, totalRows, blocks, inFlight, order],
  )

  const flush = useCallback(() => {
    scheduled.current = null
    const { start, end } = target.current
    if (!client || end <= start) return

    const firstBlock = Math.max(0, Math.floor(start / BLOCK_ROWS) - PREFETCH_BLOCKS)
    const lastBlock = Math.floor(Math.max(0, end - 1) / BLOCK_ROWS) + PREFETCH_BLOCKS
    const maxBlock = Math.floor(Math.max(0, totalRows - 1) / BLOCK_ROWS)

    for (let block = firstBlock; block <= Math.min(lastBlock, maxBlock); block++) {
      void fetchBlock(block, generation.current)
    }
  }, [client, fetchBlock, totalRows])

  const requestRange = useCallback(
    (start: number, end: number) => {
      target.current = { start, end }
      if (scheduled.current !== null) return
      scheduled.current = requestAnimationFrame(flush)
    },
    [flush],
  )

  useEffect(() => () => {
    if (scheduled.current !== null) cancelAnimationFrame(scheduled.current)
  }, [])

  return useMemo(() => {
    void version
    return {
      getRow(index: number) {
        const block = blocks.get(Math.floor(index / BLOCK_ROWS))
        return block?.[index % BLOCK_ROWS]
      },
      requestRange,
      loadedBlocks: blocks.size,
      pendingBlocks: inFlight.size,
      error,
    }
  }, [version, blocks, inFlight, requestRange, error])
}
