import { useState } from 'react'
import { Icon } from '../cadence/Icon'
import { Kbd } from '../cadence/Kbd'
import { NotificationBell } from '../cadence/NotificationBell'
import { CommandPalette } from './CommandPalette'
import { usePageAction } from '../../hooks/usePageAction'
import type { AppNotification } from '../../types/cadence'

interface TopBarProps {
  breadcrumb?: string[]
  notifications?: AppNotification[]
  unreadCount?: number
  onMarkRead?: (id: string) => void
  onMarkAllRead?: () => void
  onCheckin?: () => void
  hasKRs?: boolean
  checkedIn?: boolean
  checkInDue?: boolean
}

export function TopBar({
  breadcrumb = [],
  notifications = [],
  unreadCount = 0,
  onMarkRead,
  onMarkAllRead,
  onCheckin,
  hasKRs = false,
  checkedIn = false,
  checkInDue = false,
}: TopBarProps) {
  const [cmdOpen, setCmdOpen] = useState(false)
  const action = usePageAction()

  return (
    <>
      <header className="cd-top">
        <nav className="cd-bcrumb" aria-label="Breadcrumb">
          {breadcrumb.map((crumb, i) => (
            <span key={i}>
              {i > 0 && <span style={{ margin: '0 4px', opacity: 0.4 }}>/</span>}
              <span className={i === breadcrumb.length - 1 ? 'cd-bcrumb-now' : ''}>{crumb}</span>
            </span>
          ))}
        </nav>

        <button
          className="cd-cmd-pill"
          onClick={() => setCmdOpen(true)}
          type="button"
          aria-label="Open command palette"
        >
          <Icon name="search" size={13} />
          <span>Search…</span>
          <span className="cd-cmd-keys"><Kbd>⌘K</Kbd></span>
        </button>

        <div className="cd-top-r">
          <NotificationBell
            count={unreadCount}
            notifications={notifications}
            onMarkRead={onMarkRead ?? (() => {})}
            onMarkAllRead={onMarkAllRead ?? (() => {})}
          />
          {onCheckin && hasKRs && (
            checkedIn ? (
              <button
                className="cd-btn cd-btn--sm cd-checkin-done-btn"
                type="button"
                disabled
                title="Update the progress on your key results — takes 2 minutes"
              >
                <Icon name="check" size={13} />
                Checked in
              </button>
            ) : (
              <div className="cd-checkin-btn-wrap">
                {checkInDue && <span className="cd-checkin-due-dot" />}
                <button
                  className="cd-btn cd-btn--primary cd-btn--sm"
                  onClick={onCheckin}
                  type="button"
                  title="Update the progress on your key results — takes 2 minutes"
                >
                  <Icon name="check" size={13} />
                  Weekly check-in
                </button>
              </div>
            )
          )}
          {action && (
            <button
              className="cd-btn cd-btn--primary"
              onClick={action.onClick}
              type="button"
            >
              <Icon name={action.icon} size={14} />
              {action.label}
            </button>
          )}
        </div>
      </header>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </>
  )
}
