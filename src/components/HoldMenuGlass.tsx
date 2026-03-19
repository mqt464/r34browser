interface HoldActionCenter {
  active: boolean
  x: number
  y: number
}

export function HoldMenuGlass({
  activeAction,
  className,
  centers,
}: {
  activeAction: string | null
  className?: string
  centers: HoldActionCenter[]
}) {
  return (
    <div className={`hold-menu-glass${className ? ` ${className}` : ''}`} aria-hidden="true">
      <div className="hold-menu-glass-backdrop" />
      {centers.map((center, index) => (
        <span
          className={`hold-menu-glass-bubble${center.active && activeAction ? ' active' : ''}`}
          key={`${center.x}-${center.y}-${index}`}
          style={{
            left: `${center.x}px`,
            top: `${center.y}px`,
          }}
        />
      ))}
    </div>
  )
}
