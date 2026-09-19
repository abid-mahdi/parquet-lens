import { formatBytes, formatCount } from '../core/format'
import type { TableSummary } from '../core/summary'
import type { TableColumn } from '../core/types'

interface Props {
  summary: TableSummary
  selectedColumn: string | null
  selectedColumns: string[]
  onSelectColumn: (name: string) => void
  onToggleColumn: (name: string) => void
  onScopeToPart: (partIndex: number) => void
  scopedPart: number | null
}

export function Legend({
  summary, selectedColumn, selectedColumns, onSelectColumn, onToggleColumn, onScopeToPart, scopedPart,
}: Props) {
  const avgPartBytes = summary.parts.length ? summary.totalBytes / summary.parts.length : 0
  const avgRowGroupRows = summary.rowGroupCount ? summary.totalRows / summary.rowGroupCount : 0

  return (
    <aside className="legend" data-testid="legend">
      <section>
        <h3>Table</h3>
        <Fact label="Rows" value={formatCount(summary.totalRows)} />
        <Fact label="Columns" value={`${summary.columns.length}`} />
        <Fact label="Part files" value={`${summary.parts.length}`} />
        <Fact label="Row groups" value={`${summary.rowGroupCount}`} />
        <Fact label="On disk" value={formatBytes(summary.totalBytes)} />
        <Fact label="Compression" value={`${summary.compressionRatio.toFixed(1)}x`} />
        {summary.createdBy && <Fact label="Written by" value={summary.createdBy.split('version')[0]?.trim() ?? ''} />}
      </section>

      {summary.warnings.length > 0 && (
        <section data-testid="warnings">
          <h3>What to look at</h3>
          {summary.warnings.map((warning) => (
            <div key={warning.kind} className={`warning ${warning.kind}`}>
              <strong>{warning.message}</strong>
              {warning.detail && <span>{warning.detail}</span>}
            </div>
          ))}
        </section>
      )}

      <section>
        <h3>Schema</h3>
        <div className="tree">
          {summary.columns.map((column) => (
            <div
              key={column.name}
              className={`node${column.origin === 'partition' ? ' partition' : ''}`}
              onClick={() => onSelectColumn(column.name)}
              data-testid={`schema-${column.name}`}
            >
              <input
                type="checkbox"
                checked={selectedColumns.length === 0 || selectedColumns.includes(column.name)}
                onClick={(event) => event.stopPropagation()}
                onChange={() => onToggleColumn(column.name)}
                aria-label={`Include ${column.name} in select()`}
                data-testid={`toggle-${column.name}`}
              />
              <span className="name">{column.name}</span>
              {column.nullable && <span className="type">?</span>}
              <span className="type">{describe(column)}</span>
            </div>
          ))}
        </div>
        {summary.partitionColumns.length > 0 && (
          <div className="teach">
            <strong style={{ color: 'var(--partition)' }}>
              {summary.partitionColumns.join(', ')}
            </strong>{' '}
            {summary.partitionColumns.length === 1 ? 'is' : 'are'} stored as directory names, not inside
            the files. Spark recovers them on read, and so does this viewer.
          </div>
        )}
      </section>

      <section>
        <h3>How this file is built</h3>
        <p>
          <strong>File.</strong> Each part ends with a footer holding the schema, row-group offsets and
          statistics. A reader parses the footer first, which is why a {formatBytes(summary.totalBytes)}{' '}
          table opens instantly.
        </p>
        <p>
          <strong>Row group.</strong> A horizontal slice of rows, and the unit of parallel work. You have{' '}
          {summary.rowGroupCount} averaging {formatCount(Math.round(avgRowGroupRows))} rows.
        </p>
        <p>
          <strong>Column chunk.</strong> One column inside one row group, stored contiguously. Reading 3
          of {summary.columns.length} columns touches only those chunks.
        </p>
        <p>
          <strong>Page.</strong> The smallest compressed unit. Encoded first (dictionary or RLE), then
          compressed, so this table is {summary.compressionRatio.toFixed(1)}x smaller than its raw values.
        </p>
        <div className="teach">
          {avgPartBytes < 16 * 1024 * 1024 && summary.parts.length > 1
            ? `Your parts average ${formatBytes(avgPartBytes)}. Spark aims for roughly 128 MB per file, so coalesce() before writing would cut scheduling overhead.`
            : `Parts average ${formatBytes(avgPartBytes)}, which is in a healthy range for Spark.`}
        </div>
      </section>

      <section>
        <h3>Parts</h3>
        <div className="chunklist">
          {summary.parts.map((part, index) => (
            <button
              key={part.relativePath}
              className={`chunk${scopedPart === index ? ' selected' : ''}`}
              onClick={() => onScopeToPart(index)}
              title={part.relativePath}
              data-testid={`part-${index}`}
            >
              <span className="line">
                <span>{shortName(part.name)}</span>
                <span>{formatCount(part.rowCount)} rows</span>
              </span>
              <span className="line sub">
                <span>
                  {Object.entries(part.partitions).length > 0
                    ? Object.entries(part.partitions)
                        .map(([key, value]) => `${key}=${value ?? 'null'}`)
                        .join(' ')
                    : `${part.rowGroups.length} row group${part.rowGroups.length === 1 ? '' : 's'}`}
                </span>
                <span>{formatBytes(part.byteLength)}</span>
              </span>
              <span className="bar">
                <i style={{ width: `${Math.max(2, (part.rowCount / Math.max(1, summary.totalRows)) * 100)}%` }} />
              </span>
            </button>
          ))}
        </div>
        {scopedPart !== null && (
          <div className="teach">
            Showing one part only. This is the slice a single Spark task would read.
          </div>
        )}
      </section>

      {selectedColumn && (
        <section>
          <h3>Selected</h3>
          <p>
            Click a column header or a row to inspect it. <strong>{selectedColumn}</strong> is open in the
            panel.
          </p>
        </section>
      )}
    </aside>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="fact">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

function describe(column: TableColumn): string {
  if (column.origin === 'partition') return 'partition'
  return column.sparkType ?? column.logicalType ?? column.physicalType ?? '?'
}

function shortName(name: string): string {
  const match = /^part-(\d+)/.exec(name)
  return match ? `part-${match[1]}` : name.slice(0, 22)
}
