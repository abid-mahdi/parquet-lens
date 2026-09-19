import { useState } from 'react'

interface Props {
  label: string
  code: string
}

/** Closes the loop for someone who already knows the spark-shell equivalent. */
export function SparkSnippet({ label, code }: Props) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="snippet">
      <div className="snippet-head">
        <span>{label}</span>
        <span className="spacer" />
        <button
          onClick={async () => {
            await navigator.clipboard?.writeText(code)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre data-testid="spark-snippet">{code}</pre>
    </div>
  )
}
