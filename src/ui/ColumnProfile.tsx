import { formatBytes, formatCount } from '../core/format'
import type { TableSummary } from '../core/summary'
import type { TableColumn } from '../core/types'
import { SparkSnippet } from './SparkSnippet'

interface Props {
  column: TableColumn
  summary: TableSummary
  onClose: () => void
}

export function ColumnProfile({ column, summary, onClose }: Props) {
  const chunks = summary.parts.flatMap((part) =>
    part.rowGroups.flatMap((group) =>
      group.columns.filter((chunk) => chunk.name === column.name).map((chunk) => ({ part, group, chunk })),
    ),
  )

  const compressed = chunks.reduce((sum, c) => sum + c.chunk.compressedBytes, 0)
  const uncompressed = chunks.reduce((sum, c) => sum + c.chunk.uncompressedBytes, 0)
  const nullCounts = chunks.map((c) => c.chunk.nullCount).filter((n): n is number => n !== null)
  const nulls = nullCounts.length ? nullCounts.reduce((a, b) => a + b, 0) : null
  const encodings = [...new Set(chunks.flatMap((c) => c.chunk.encodings))]
  const codecs = [...new Set(chunks.map((c) => c.chunk.codec))]
  const mins = chunks.map((c) => c.chunk.min).filter((m): m is string => m !== null)
  const maxes = chunks.map((c) => c.chunk.max).filter((m): m is string => m !== null)

  return (
    <div className="drawer" data-testid="column-profile">
      <header>
        <h3>{column.name}</h3>
        <span className="spacer" />
        <button onClick={onClose} data-testid="close-drawer">
          Close
        </button>
      </header>
      <div className="body">
        {column.origin === 'partition' ? (
          <>
            <div className="kv">
              <div className="k partition">Origin</div>
              <div className="v">Hive partition directory</div>
              <div className="k">Values</div>
              <div className="v">
                {[...new Set(summary.parts.map((p) => p.partitions[column.name] ?? 'null'))].join(', ')}
              </div>
              <div className="k">Stored in file</div>
              <div className="v">No. Recovered from the directory path.</div>
            </div>
            <div className="teach" style={{ marginTop: 12 }}>
              Filtering on a partition column lets Spark skip entire directories without opening a single
              parquet file. That is partition pruning, the cheapest filter there is.
            </div>
            <SparkSnippet
              label="Spark equivalent"
              code={`${summary.name}.filter($"${column.name}" === "${
                summary.parts[0]?.partitions[column.name] ?? ''
              }")  // prunes whole directories`}
            />
          </>
        ) : (
          <>
            <div className="kv">
              <div className="k">Spark type</div>
              <div className="v">{column.sparkType ?? 'unknown'}</div>
              <div className="k">Parquet type</div>
              <div className="v">{column.physicalType ?? 'group'}</div>
              {column.logicalType && (
                <>
                  <div className="k">Logical type</div>
                  <div className="v">{column.logicalType}</div>
                </>
              )}
              <div className="k">Nullable</div>
              <div className="v">{column.nullable ? 'yes' : 'no'}</div>
              <div className="k">Nulls</div>
              <div className="v">{nulls === null ? 'not recorded' : formatCount(nulls)}</div>
              <div className="k">Encodings</div>
              <div className="v">{encodings.join(', ') || 'unknown'}</div>
              <div className="k">Codec</div>
              <div className="v">{codecs.join(', ') || 'none'}</div>
              <div className="k">Compressed</div>
              <div className="v">{formatBytes(compressed)}</div>
              <div className="k">Uncompressed</div>
              <div className="v">{formatBytes(uncompressed)}</div>
              <div className="k">Ratio</div>
              <div className="v">{compressed > 0 ? `${(uncompressed / compressed).toFixed(1)}x` : '-'}</div>
              {mins.length > 0 && (
                <>
                  <div className="k">Min</div>
                  <div className="v">{mins[0]}</div>
                  <div className="k">Max</div>
                  <div className="v">{maxes[maxes.length - 1]}</div>
                </>
              )}
              <div className="k">Chunks</div>
              <div className="v">{chunks.length}</div>
            </div>

            <div className="teach" style={{ marginTop: 12 }}>
              {mins.length > 0
                ? `Each of the ${chunks.length} chunks carries its own min and max, so a reader can skip whole row groups whose range cannot match a filter. That is predicate pushdown.`
                : 'This column has no statistics, so every filter on it must read all the data.'}
            </div>

            {encodings.some((e) => e.includes('DICTIONARY')) && (
              <div className="teach" style={{ marginTop: 8 }}>
                Dictionary encoding is in use, which means this column has relatively few distinct values.
                Repeated values are stored once and referenced by index.
              </div>
            )}

            <SparkSnippet
              label="Spark equivalent"
              code={`${summary.name}.select($"${column.name}").describe().show()\n${summary.name}.select($"${column.name}").distinct().count()`}
            />
          </>
        )}
      </div>
    </div>
  )
}
