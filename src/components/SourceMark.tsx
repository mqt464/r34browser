import { SOURCE_ICONS } from '../lib/sources'
import type { SourceId } from '../types'

export function SourceIcon({
  source,
  className = '',
  label,
  size = 16,
}: {
  source: SourceId
  className?: string
  label?: string
  size?: number
}) {
  return (
    <img
      alt={label ?? ''}
      aria-hidden={label ? undefined : true}
      className={className}
      height={size}
      src={SOURCE_ICONS[source]}
      width={size}
    />
  )
}

export function SourceBadge({
  source,
  className = '',
  label,
}: {
  source: SourceId
  className?: string
  label: string
}) {
  return (
    <span className={`source-badge${className ? ` ${className}` : ''}`}>
      <SourceIcon className="source-badge-icon" label="" size={14} source={source} />
      <span>{label}</span>
    </span>
  )
}
