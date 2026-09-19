import { useCallback, useRef, useState } from 'react'
import { sourcesFromDataTransfer, sourcesFromFileList } from '../core/sources'
import type { SourceFile } from '../core/types'

interface Props {
  onFiles: (sources: SourceFile[]) => void
  busy: boolean
}

export function DropZone({ onFiles, busy }: Props) {
  const [active, setActive] = useState(false)
  const depth = useRef(0)
  const input = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault()
      depth.current = 0
      setActive(false)
      onFiles(await sourcesFromDataTransfer(event.dataTransfer.items))
    },
    [onFiles],
  )

  return (
    <div
      className={`dropzone${active ? ' active' : ''}`}
      data-testid="dropzone"
      onDragEnter={(e) => {
        e.preventDefault()
        depth.current++
        setActive(true)
      }}
      onDragLeave={() => {
        depth.current--
        if (depth.current <= 0) setActive(false)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <h2>{busy ? 'Reading footers...' : 'Drop a Spark output folder'}</h2>
      <p>
        Drop the whole directory Spark wrote, the one containing{' '}
        <code>part-00000-....snappy.parquet</code> and <code>_SUCCESS</code>. Every part is read as one
        table, and <code>year=/month=</code> directories become real columns.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => input.current?.click()} disabled={busy}>
          Choose folder
        </button>
      </div>
      <p className="hint">Nothing is uploaded. Files are read in this tab and never leave your machine.</p>
      <input
        ref={input}
        type="file"
        multiple
        data-testid="file-input"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) onFiles(sourcesFromFileList(e.target.files))
        }}
        {...{ webkitdirectory: '', directory: '' }}
      />
    </div>
  )
}
