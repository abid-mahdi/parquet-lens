import type { Row } from '../core/types'
import type { TableSummary } from '../core/summary'
import type { Query } from '../core/query'
import type { ViewStats } from '../core/execute'
import type { DroppedFile, WorkerRequest, WorkerResponse } from './protocol'

interface Pending {
  resolve: (response: WorkerResponse) => void
  reject: (error: Error) => void
  onProgress?: (fraction: number) => void
}

export interface QueryResult {
  rowCount: number
  stats: ViewStats
}

export class ParquetClient {
  private readonly worker: Worker
  private readonly pending = new Map<number, Pending>()
  private nextId = 1

  constructor() {
    this.worker = new Worker(new URL('./parquet.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data
      const entry = this.pending.get(response.id)
      if (!entry) return

      if (response.kind === 'progress') {
        entry.onProgress?.(response.fraction)
        return
      }

      this.pending.delete(response.id)
      if (response.kind === 'error') entry.reject(new Error(response.message))
      else entry.resolve(response)
    }
  }

  async open(name: string, files: DroppedFile[]): Promise<TableSummary> {
    const response = await this.send({ id: this.nextId++, kind: 'open', name, files })
    if (response.kind !== 'open') throw new Error('Unexpected worker response')
    return response.summary
  }

  async applyQuery(query: Query, onProgress?: (fraction: number) => void): Promise<QueryResult> {
    const response = await this.send({ id: this.nextId++, kind: 'query', query }, onProgress)
    if (response.kind !== 'query') throw new Error('Unexpected worker response')
    return { rowCount: response.rowCount, stats: response.stats }
  }

  async rows(start: number, end: number, columns?: string[]): Promise<Row[]> {
    const response = await this.send({ id: this.nextId++, kind: 'rows', start, end, columns })
    if (response.kind !== 'rows') throw new Error('Unexpected worker response')
    return response.rows
  }

  /** Scrolling past a pending window must not keep the worker busy decoding it. */
  cancel(id: number): void {
    this.worker.postMessage({ id: this.nextId++, kind: 'cancel', target: id } satisfies WorkerRequest)
  }

  terminate(): void {
    this.worker.terminate()
    this.pending.clear()
  }

  private send(
    request: WorkerRequest,
    onProgress?: (fraction: number) => void,
  ): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject, onProgress })
      this.worker.postMessage(request)
    })
  }
}
