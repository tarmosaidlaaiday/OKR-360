import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { getMyAllTasks, updatePersonalTaskStatus, createPersonalTask } from '../services/personalTasks.service'
import { updateKrTaskStatus } from '../services/krTasks.service'
import { Avatar } from '../components/cadence/Avatar'
import { Icon } from '../components/cadence/Icon'
import { getErrorMessage } from '../lib/errors'
import type { UnifiedTask, KrTaskStatus } from '../types/cadence'

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtDate(d: string | null): string {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function isOverdue(d: string | null, status: KrTaskStatus): boolean {
  if (!d || status === 'done') return false
  return new Date(d + 'T00:00:00') < new Date(new Date().toDateString())
}

// ── Task check button ─────────────────────────────────────────────────────

function TaskCheck({ status, onClick }: { status: KrTaskStatus; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`cd-kr-task-check cd-kr-task-check--${status}`}
      onClick={onClick}
      title={status === 'todo' ? 'Mark in progress' : status === 'in_progress' ? 'Mark done' : 'Reset to todo'}
    >
      {status === 'in_progress' && <Icon name="circle" size={8} />}
      {status === 'done' && <Icon name="check" size={10} />}
    </button>
  )
}

// ── Unified task row ──────────────────────────────────────────────────────

function TaskRow({ task, onStatusChange }: { task: UnifiedTask; onStatusChange: (id: string, status: KrTaskStatus) => void }) {
  const overdue = isOverdue(task.due_date, task.status)
  const dateLabel = fmtDate(task.due_date)

  function cycleStatus() {
    const next: KrTaskStatus = task.status === 'todo' ? 'in_progress'
      : task.status === 'in_progress' ? 'done' : 'todo'
    onStatusChange(task.id, next)
  }

  return (
    <div className={`cd-ut-row${task.status === 'done' ? ' cd-kr-task-done' : ''}`}>
      <TaskCheck status={task.status} onClick={cycleStatus} />
      {task.assignee && (
        <Avatar
          person={{
            id: task.assignee.id,
            name: task.assignee.full_name,
            initials: task.assignee.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
            color: task.assignee.color,
            role: '',
            avatar_url: task.assignee.avatar_url,
          }}
          size={20}
        />
      )}
      <span className="cd-kr-task-title" style={{ flex: 1 }}>{task.title}</span>
      <span className="cd-ut-source">{task.source_label}</span>
      {dateLabel && (
        <span
          className="cd-ut-due"
          style={{ color: overdue ? 'var(--danger)' : undefined }}
        >
          {overdue ? '⚠ ' : ''}{dateLabel}
        </span>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

type SourceFilter = 'all' | 'kr' | 'personal'
type StatusFilter = 'open' | 'done' | 'all'

export function TasksPage() {
  const { user, profile } = useAuth()
  const [tasks, setTasks] = useState<UnifiedTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')

  // Quick-add
  const [addTitle, setAddTitle] = useState('')
  const [addDue, setAddDue] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    if (!user?.id) return
    setLoading(true)
    setError(null)
    try {
      const all = await getMyAllTasks(user.id)
      setTasks(all)
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => { load() }, [load])

  async function handleStatusChange(id: string, status: KrTaskStatus) {
    const task = tasks.find(t => t.id === id)
    if (!task) return
    // Optimistic update
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t))
    try {
      if (task.source === 'kr') {
        await updateKrTaskStatus(id, status)
      } else {
        await updatePersonalTaskStatus(id, status)
      }
    } catch (e) {
      // Roll back
      setTasks(prev => prev.map(t => t.id === id ? { ...t, status: task.status } : t))
      setError(getErrorMessage(e))
    }
  }

  async function handleAddTask(e: React.FormEvent) {
    e.preventDefault()
    const title = addTitle.trim()
    if (!title || !user?.id || !profile?.org_id) return
    setAdding(true)
    try {
      const created = await createPersonalTask({
        org_id: profile.org_id,
        title,
        assignee_id: user.id,
        created_by: user.id,
        due_date: addDue || null,
      })
      // Add to unified list inline
      const newTask: UnifiedTask = {
        id: created.id,
        source: 'personal',
        title: created.title,
        status: created.status,
        due_date: created.due_date,
        assignee_id: created.assignee_id,
        assignee: created.assignee ?? undefined,
        source_label: 'Personal',
        one_on_one_id: null,
      }
      setTasks(prev => {
        const next = [...prev, newTask]
        next.sort((a, b) => {
          if (!a.due_date && !b.due_date) return 0
          if (!a.due_date) return 1
          if (!b.due_date) return -1
          return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0
        })
        return next
      })
      setAddTitle('')
      setAddDue('')
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setAdding(false)
    }
  }

  // Apply filters
  const filtered = tasks.filter(t => {
    if (sourceFilter !== 'all' && t.source !== sourceFilter) return false
    if (statusFilter === 'open' && t.status === 'done') return false
    if (statusFilter === 'done' && t.status !== 'done') return false
    return true
  })

  const openCount = tasks.filter(t => t.status !== 'done').length

  return (
    <div className="cd-page">
      <header className="cd-pgh">
        <div>
          <div className="cd-pgh-eyebrow">My Tasks</div>
          <h1 className="cd-pgh-title">Everything on your plate.</h1>
          <p className="cd-pgh-sub">KR tasks, 1:1 follow-ups, and personal to-dos in one place.</p>
        </div>
      </header>

      <div className="cd-card" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 0 }}>
        {/* Filters */}
        <div className="cd-ut-filters">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)', marginRight: 2 }}>Status</span>
            {(['open', 'done', 'all'] as StatusFilter[]).map(f => (
              <button
                key={f}
                type="button"
                className={'cd-btn cd-btn-ghost cd-btn-tiny' + (statusFilter === f ? ' is-on' : '')}
                style={statusFilter === f ? { background: 'color-mix(in oklab, var(--accent) 12%, transparent)', color: 'var(--accent)' } : {}}
                onClick={() => setStatusFilter(f)}
              >
                {f === 'open' ? `Open (${openCount})` : f === 'done' ? 'Done' : 'All'}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)', marginRight: 2 }}>Source</span>
            {(['all', 'personal', 'kr'] as SourceFilter[]).map(f => (
              <button
                key={f}
                type="button"
                className={'cd-btn cd-btn-ghost cd-btn-tiny' + (sourceFilter === f ? ' is-on' : '')}
                style={sourceFilter === f ? { background: 'color-mix(in oklab, var(--accent) 12%, transparent)', color: 'var(--accent)' } : {}}
                onClick={() => setSourceFilter(f)}
              >
                {f === 'all' ? 'All sources' : f === 'personal' ? 'Personal / 1:1' : 'Key results'}
              </button>
            ))}
          </div>
        </div>

        {/* Task list */}
        {loading && <p className="cd-loading" style={{ padding: '24px 0' }}>Loading tasks…</p>}
        {error && <p style={{ color: 'var(--danger)', fontSize: 13, padding: '12px 0' }}>{error}</p>}

        {!loading && filtered.length === 0 && (
          <div style={{ padding: '32px 0', textAlign: 'center' }}>
            <Icon name="task" size={28} />
            <p style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-soft)' }}>
              {statusFilter === 'open' ? 'No open tasks — great work!' : 'No tasks match this filter.'}
            </p>
          </div>
        )}

        <div className="cd-kr-task-list" style={{ marginTop: loading || filtered.length === 0 ? 0 : 8 }}>
          {filtered.map(task => (
            <TaskRow key={task.id} task={task} onStatusChange={handleStatusChange} />
          ))}
        </div>

        {/* Quick-add personal task */}
        <form
          onSubmit={handleAddTask}
          className="cd-ut-add"
          style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}
        >
          <span style={{ color: 'var(--ink-faint)', flexShrink: 0, display: 'flex' }}><Icon name="plus" size={14} /></span>
          <input
            className="cd-kr-task-add-input"
            placeholder="Add a personal task…"
            value={addTitle}
            onChange={e => setAddTitle(e.target.value)}
            disabled={adding}
          />
          <input
            type="date"
            className="cd-um-input"
            value={addDue}
            onChange={e => setAddDue(e.target.value)}
            disabled={adding}
            style={{ fontSize: 12, padding: '2px 6px', width: 130 }}
          />
          <button
            type="submit"
            className="cd-btn cd-btn-primary cd-btn-tiny"
            disabled={adding || !addTitle.trim()}
          >
            {adding ? '…' : 'Add'}
          </button>
        </form>
      </div>
    </div>
  )
}
