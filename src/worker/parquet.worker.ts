import { buildTable } from '../core/table'
import { summariseTable } from '../core/summary'
import { readRows } from '../core/reader'
import { fileSource } from '../core/sources'
import { buildView, identityView, readByIndices } from '../core/execute'
import type { TableView } from '../core/execute'
import type { SparkTable } from '../core/types'
import type { WorkerRequest, WorkerResponse } from './protocol'

let table: SparkTable | null = null
let view: TableView | null = null
const inFlight = new Map<number, AbortController>()

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data

  if (request.kind === 'cancel') {
    inFlight.get(request.target)?.abort()
    return
  }

  const controller = new AbortController()
  inFlight.set(request.id, controller)

  try {
    reply(await handle(request, controller.signal))
  } catch (error) {
    if (!controller.signal.aborted) {
      reply({ id: request.id, kind: 'error', message: messageOf(error) })
    }
  } finally {
    inFlight.delete(request.id)
  }
}

async function handle(
  request: Exclude<WorkerRequest, { kind: 'cancel' }>,
  signal: AbortSignal,
): Promise<WorkerResponse> {
  if (request.kind === 'open') {
    const sources = request.files.map((dropped) => fileSource(dropped.file, dropped.relativePath))
    table = await buildTable(request.name, sources)
    view = identityView(table)
    return { id: request.id, kind: 'open', summary: summariseTable(table) }
  }

  if (!table) throw new Error('No table open')

  if (request.kind === 'query') {
    view = await buildView(table, request.query, {
      signal,
      onProgress: (fraction) => reply({ id: request.id, kind: 'progress', fraction }),
    })
    return { id: request.id, kind: 'query', rowCount: view.rowCount, stats: view.stats }
  }

  const rows = view?.indices
    ? await readByIndices(view.indices, request.start, request.end, request.columns, (from, to, cols) =>
        readRows(table as SparkTable, from, to, cols, { signal }),
      )
    : await readRows(table, request.start, request.end, request.columns, { signal })

  return { id: request.id, kind: 'rows', start: request.start, rows }
}

function reply(response: WorkerResponse): void {
  self.postMessage(response)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
