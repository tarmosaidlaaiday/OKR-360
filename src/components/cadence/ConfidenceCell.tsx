import { confidenceColor, confidenceTextColor } from '../../lib/colors'

interface ConfidenceCellProps {
  value: number | null | undefined
  size?: number
  showNum?: boolean
  current?: boolean
}

export function ConfidenceCell({ value, size = 24, showNum = true, current = false }: ConfidenceCellProps) {
  if (value == null) {
    return (
      <span
        className="cd-conf-empty"
        style={{ width: size, height: size, fontSize: Math.max(10, size * 0.4) }}
        title="No confidence logged yet"
      >
        –
      </span>
    )
  }
  return (
    <span
      className={'cd-conf-cell ' + (current ? 'is-current' : '')}
      style={{
        width: size, height: size,
        background: confidenceColor(value),
        color: confidenceTextColor(value),
        fontSize: Math.max(10, size * 0.42),
      }}
    >
      {showNum ? value : ''}
    </span>
  )
}
