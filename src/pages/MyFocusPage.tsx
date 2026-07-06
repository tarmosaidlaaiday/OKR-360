import { useState } from 'react'
import { useCycle } from '../context/CycleContext'
import { useAuth } from '../context/AuthContext'
import { useMyFocusObjectives } from '../hooks/useMyFocusObjectives'
import { useKrTasks } from '../hooks/useKrTasks'
import { PageHeader } from '../components/cadence/PageHeader'
import { LevelBadge } from '../components/cadence/LevelBadge'
import { StatusChip } from '../components/cadence/StatusChip'
import { Avatar } from '../components/cadence/Avatar'
import { ProgressBar } from '../components/cadence/ProgressBar'
import { Icon } from '../components/cadence/Icon'
import { fmt, getQuarterWeeks, getCurrentWeekIdx } from '../lib/cadenceUtils'
import type { CadenceObjective, CadenceKeyResult, KrTask, KrTaskStatus } from '../types/cadence'

// ── Task check button: cycles todo → in_progress → done → todo ───────────

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

// ── KR row with inline task list ─────────────────────────────────────────

function KrWithTasks({ kr, userId }: { kr: CadenceKeyResult; userId: string }) {
  const { tasks, addTask, updateStatus, removeTask } = useKrTasks(kr.id, userId)
  const [newTitle, setNewTitle] = useState('')

  function cycleStatus(task: KrTask) {
    const next: KrTaskStatus = task.status === 'todo' ? 'in_progress' : task.status === 'in_progress' ? 'done' : 'todo'
    updateStatus(task.id, next)
  }

  async function handleAddTask(e: React.FormEvent) {
    e.preventDefault()
    const title = newTitle.trim()
    if (!title) return
    setNewTitle('')
    await addTask(title)
  }

  return (
    <div>
      {/* KR row */}
      <div className="cd-okr-row cd-okr-row--kr">
        <div className="cd-okr-col-level" />
        <div className="cd-okr-col-title">
          <span className="cd-okr-kr-indent" />
          <span className="cd-okr-kr-title">{kr.title}</span>
        </div>
        <div className="cd-okr-col-supports" />
        <div className="cd-okr-col-owner">
          <Avatar person={kr.owner ?? null} size={18} />
        </div>
        <div className="cd-okr-col-status" />
        <div className="cd-okr-col-progress">
          {kr.target_type !== 'boolean' ? (
            <>
              <ProgressBar value={Math.min(1, kr.current_value / (kr.target_value || 1))} height={4} />
              <span className="cd-okr-pct">
                {fmt(kr.current_value)}{kr.unit ?? ''} / {fmt(kr.target_value)}{kr.unit ?? ''}
              </span>
            </>
          ) : (
            <span className="cd-okr-pct">{kr.current_value ? 'Done' : 'Not done'}</span>
          )}
        </div>
        <div className="cd-okr-conf-row" />
      </div>

      {/* Inline task list */}
      <div className="cd-kr-task-list">
        {tasks.map(task => (
          <div key={task.id} className={`cd-kr-task-row${task.status === 'done' ? ' cd-kr-task-done' : ''}`}>
            <TaskCheck status={task.status} onClick={() => cycleStatus(task)} />
            <span className="cd-kr-task-title">{task.title}</span>
            <button
              type="button"
              className="cd-kr-task-del cd-btn-icon"
              onClick={() => removeTask(task.id)}
              title="Remove task"
            >
              <Icon name="x" size={11} />
            </button>
          </div>
        ))}

        {/* Add task input */}
        <form className="cd-kr-task-add" onSubmit={handleAddTask}>
          <button type="submit" className="cd-kr-task-check" style={{ opacity: 0.35 }} tabIndex={-1}>
            <Icon name="plus" size={10} />
          </button>
          <input
            className="cd-kr-task-add-input"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder="Add task…"
          />
        </form>
      </div>
    </div>
  )
}

// ── Objective block ───────────────────────────────────────────────────────

function FocusObjBlock({ obj, userId }: { obj: CadenceObjective; userId: string }) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="cd-okr-obj-block">
      {/* Objective row */}
      <div
        className="cd-okr-row cd-okr-row--obj"
        onClick={() => setExpanded(e => !e)}
        style={{ cursor: 'pointer' }}
      >
        <div className="cd-okr-col-level">
          <LevelBadge level={obj.level} size="sm" />
        </div>
        <div className="cd-okr-col-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            className="cd-okr-expand"
            aria-label="Toggle"
            onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
          >
            <Icon name={expanded ? 'chevron' : 'chevronR'} size={13} />
          </button>
          <span className="cd-okr-obj-title">{obj.title}</span>
        </div>
        <div className="cd-okr-col-supports" />
        <div className="cd-okr-col-owner">
          <Avatar person={obj.owner ?? null} size={22} />
        </div>
        <div className="cd-okr-col-status">
          <StatusChip status={obj.status} size="sm" />
        </div>
        <div className="cd-okr-col-progress">
          <ProgressBar value={obj.progress} height={5} />
          <span className="cd-okr-pct">{fmt(obj.progress * 100)}%</span>
        </div>
        <div className="cd-okr-conf-row" />
      </div>

      {/* KRs with tasks */}
      {expanded && obj.key_results.map(kr => (
        <KrWithTasks key={kr.id} kr={kr} userId={userId} />
      ))}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────

export function MyFocusPage() {
  const { activeCycle } = useCycle()
  const { profile } = useAuth()

  const quarter = activeCycle?.quarter ?? 1
  const year = activeCycle?.year ?? new Date().getFullYear()

  const userId = profile?.id ?? null
  const { objectives, loading, error } = useMyFocusObjectives(activeCycle?.id ?? null, userId, quarter, year)

  const weeks = getQuarterWeeks(quarter)
  const currentWeekIdx = getCurrentWeekIdx(quarter)

  if (loading) return <div className="cd-page"><p className="cd-loading">Loading…</p></div>
  if (error) return <div className="cd-page"><p style={{ color: 'var(--bad)', padding: '16px 0' }}>{error}</p></div>

  return (
    <div className="cd-page">
      <PageHeader
        title="My Focus"
        sub={activeCycle?.label}
      />

      <div className="cd-okr-table">
        {/* Header */}
        <div className="cd-okr-header">
          <span className="cd-okr-col-level">Level</span>
          <span className="cd-okr-col-title">Objective / Key Result</span>
          <span className="cd-okr-col-supports" />
          <span className="cd-okr-col-owner">Owner</span>
          <span className="cd-okr-col-status">Status</span>
          <span className="cd-okr-col-progress">Progress</span>
          <div className="cd-okr-conf-header">
            {weeks.map((w, i) => (
              <span key={w} className={'cd-okr-week' + (i === currentWeekIdx ? ' is-current' : '')}>W{w}</span>
            ))}
          </div>
        </div>

        {objectives.length === 0 ? (
          <p className="cd-empty-hint" style={{ padding: '2rem' }}>
            No objectives assigned to you for this cycle.
          </p>
        ) : (
          objectives.map(obj => (
            <FocusObjBlock key={obj.id} obj={obj} userId={profile!.id} />
          ))
        )}
      </div>
    </div>
  )
}
