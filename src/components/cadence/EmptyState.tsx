interface EmptyStateProps {
  icon?: string
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
}

export function EmptyState({ icon = 'inbox', title, description, action }: EmptyStateProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px 16px',
      textAlign: 'center',
      minHeight: 120,
      gap: 8,
    }}>
      <i className={`ti ti-${icon}`} style={{ fontSize: 24, color: 'var(--ink-faint)' }} />
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{title}</div>
      {description && (
        <div style={{ fontSize: 13, color: 'var(--ink-mid)', maxWidth: 320, lineHeight: 1.5 }}>
          {description}
        </div>
      )}
      {action && (
        <button
          type="button"
          className="cd-btn cd-btn--primary"
          onClick={action.onClick}
          style={{ marginTop: 8 }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
