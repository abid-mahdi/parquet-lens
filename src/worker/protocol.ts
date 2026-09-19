import type { Row } from '../core/types'
import type { TableSummary } from '../core/summary'
import type { Query } from '../core/query'
import type { ViewStats } from '../core/execute'

export interface DroppedFile {
  file: File
  relativePath: string
}

export type WorkerRequest =
  | { id: number; kind: 'open'; name: string; files: DroppedFile[] }
  | { id: number; kind: 'query'; query: Query }
  | { id: number; kind: 'rows'; start: number; end: number; columns?: string[] }
  | { id: number; kind: 'cancel'; target: number }

export type WorkerResponse =
  | { id: number; kind: 'open'; summary: TableSummary }
  | { id: number; kind: 'query'; rowCount: number; stats: ViewStats }
  | { id: number; kind: 'rows'; start: number; rows: Row[] }
  | { id: number; kind: 'progress'; fraction: number }
  | { id: number; kind: 'error'; message: string }
