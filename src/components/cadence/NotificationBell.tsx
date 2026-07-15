import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from './Icon'
import { timeAgo } from '../../lib/notifications'
import type { AppNotification } from '../../types/cadence'

// ── Per-type metadata ────────────────────────────────────────────────────

type IconName = 'check' | 'bell' | 'alertTriangle' | 'flag' | 'retro' | 'link' | 'mail' | 'user' | 'chat' | 'checkCircle'

interface TypeMeta {
  icon: IconName
  color: string
}

const TYPE_META: Record<AppNotification['type'], TypeMeta> = {
  checkin_due:       { icon: 'check',         color: 'var(--accent)'   },
  checkin_reminder:  { icon: 'bell',          color: 'var(--warn)'     },
  blocker_flagged:   { icon: 'alertTriangle', color: 'var(--bad)'      },
  nudge:             { icon: 'user',          color: 'var(--ink-soft)' },
  review_open:       { icon: 'flag',          color: 'var(--accent)'   },
  cycle_archived:    { icon: 'retro',         color: 'var(--ok)'       },
  okr_unaligned:     { icon: 'link',          color: 'var(--warn)'     },
  invite_accepted:   { icon: 'mail',          color: 'var(--ok)'       },
  comment_added:     { icon: 'chat',          color: 'var(--accent)'   },
  task_assigned:     { icon: 'checkCircle',   color: 'var(--ok)'       },
}

function getTypeMeta(type: string): TypeMeta {
  return TYPE_META[type as AppNotification['type']] ?? { icon: 'bell', color: 'var(--ink-soft)' }
}

// ── Component ────────────────────────────────────────────────────────────

interface NotificationBellProps {
  count: number
  notifications: AppNotification[]
  onMarkRead: (id: string) => void
  onMarkAllRead: () => void
}

export function NotificationBell({ count, notifications, onMarkRead, onMarkAllRead }: NotificationBellProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [close])

  function handleNotifClick(n: AppNotification) {
    if (!n.read) onMarkRead(n.id)
    if (n.action_url) {
      close()
      navigate(n.action_url)
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="cd-btn-icon cd-notif-bell"
        onClick={() => setOpen(o => !o)}
        aria-label={`Notifications${count > 0 ? ` (${count} unread)` : ''}`}
        aria-expanded={open}
      >
        <Icon name="bell" size={16} />
        {count > 0 && (
          <span className="cd-notif-badge">{count > 9 ? '9+' : count}</span>
        )}
      </button>

      {open && (
        <div className="cd-notif-dropdown">
          <div className="cd-notif-dropdown-hd">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Notifications</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {count > 0 && (
                <button
                  type="button"
                  className="cd-btn"
                  style={{ fontSize: 11, padding: '2px 8px' }}
                  onClick={onMarkAllRead}
                >
                  Mark all read
                </button>
              )}
              <button
                type="button"
                className="cd-btn-icon"
                style={{ fontSize: 11 }}
                onClick={() => { close(); navigate('/settings/notifications') }}
                title="Notification settings"
              >
                <Icon name="settings" size={13} />
              </button>
            </div>
          </div>

          <div className="cd-notif-list">
            {notifications.length === 0 ? (
              <div className="cd-notif-empty">No notifications</div>
            ) : (
              notifications.map(n => {
                const meta = getTypeMeta(n.type)
                return (
                  <div
                    key={n.id}
                    className={'cd-notif-item' + (n.read ? '' : ' cd-notif-item--unread')
                      + (n.action_url ? ' cd-notif-item--link' : '')}
                    onClick={() => handleNotifClick(n)}
                    role={n.action_url || !n.read ? 'button' : undefined}
                    tabIndex={n.action_url || !n.read ? 0 : undefined}
                    onKeyDown={e => e.key === 'Enter' && handleNotifClick(n)}
                  >
                    <span className="cd-notif-icon" style={{ color: meta.color }}>
                      <Icon name={meta.icon} size={14} />
                    </span>
                    <div className="cd-notif-body">
                      <div className="cd-notif-title">{n.title}</div>
                      {n.body && <div className="cd-notif-sub">{n.body}</div>}
                      <div className="cd-notif-time">{timeAgo(n.created_at)}</div>
                    </div>
                    {!n.read && <span className="cd-notif-dot" />}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
