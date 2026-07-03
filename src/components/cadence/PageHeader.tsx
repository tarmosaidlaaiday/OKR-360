import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: ReactNode
  eyebrow?: ReactNode
  sub?: ReactNode
  actions?: ReactNode
}

export function PageHeader({ title, eyebrow, sub, actions }: PageHeaderProps) {
  return (
    <header className="cd-pgh">
      <div className="cd-pgh-titlewrap">
        {eyebrow && <div className="cd-pgh-eyebrow">{eyebrow}</div>}
        <h1 className="cd-pgh-title">{title}</h1>
        {sub && <p className="cd-pgh-sub">{sub}</p>}
      </div>
      {actions && <div className="cd-pg-act">{actions}</div>}
    </header>
  )
}
