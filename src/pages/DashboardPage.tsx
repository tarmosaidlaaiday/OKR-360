import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useCycle } from '../context/CycleContext'
import { supabase } from '../lib/supabase'
import { useCadenceObjectives } from '../hooks/useCadenceObjectives'
import { useReviewCycle } from '../hooks/useReviewCycle'
import { PageHeader } from '../components/cadence/PageHeader'
import { Card, CardHeader } from '../components/cadence/Card'
import { Avatar } from '../components/cadence/Avatar'
import { ConfidenceCell } from '../components/cadence/ConfidenceCell'
import { Icon } from '../components/cadence/Icon'
import { Segmented } from '../components/cadence/Segmented'
import { confidenceColor } from '../lib/colors'
import { profileToPerson, getCurrentWeekIdx, getISOWeek } from '../lib/cadenceUtils'
import { toggleTask, addQuickTask } from '../services/tasks.service'
import type { Task, OneOnOne, Person } from '../types/cadence'
import type { CadenceObjective } from '../types/cadence'
import { usePageTitle } from '../hooks/usePageTitle'

// ── Helpers ───────────────────────────────────────────────────────────────

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function getWeekBounds() {
  const now = new Date()
  const day = now.getDay() || 7          // 1=Mon … 7=Sun
  const mon = new Date(now)
  mon.setDate(now.getDate() - day + 1)
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  return {
    start: mon.toISOString().slice(0, 10),
    end:   sun.toISOString().slice(0, 10),
    today: now.toISOString().slice(0, 10),
  }
}

function endOfWeek(): string {
  return getWeekBounds().end
}

type Period = 'day' | 'week' | 'q'

function filterByPeriod(tasks: Task[], period: Period): Task[] {
  const { start, end, today } = getWeekBounds()
  return tasks.filter(t => {
    if (t.done) return false
    if (!t.due_date) return period === 'q'
    if (period === 'day')  return t.due_date === today
    if (period === 'week') return t.due_date >= start && t.due_date <= end
    return true // quarter = all open
  })
}

// ── Sub-components ────────────────────────────────────────────────────────

function ObjectiveRow({
  o, weekIdx,
}: {
  o: CadenceObjective
  weekIdx: number
}) {
  const navigate = useNavigate()
  const conf  = o.confidence[weekIdx] ?? null
  const prev  = o.confidence[weekIdx - 1] ?? null
  const delta = conf != null && prev != null ? conf - prev : null

  return (
    <a
      className="cd-obj-row"
      href="#"
      onClick={e => { e.preventDefault(); navigate('/okrs') }}
    >
      <div className="cd-obj-conf">
        <ConfidenceCell value={conf} size={32} />
        {delta != null && (
          <div className={'cd-obj-delta ' + (delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : '')}>
            {delta > 0 ? '↑' : delta < 0 ? '↓' : '→'}{delta !== 0 ? ` ${Math.abs(delta)}` : ''}
          </div>
        )}
      </div>
      <div className="cd-obj-body">
        <div className="cd-obj-team">
          <Icon name="grid" size={11} /> {(o.team as any)?.name ?? 'No team'}
        </div>
        <div className="cd-obj-title">{o.title}</div>
        <div className="cd-obj-krs">
          {(o.key_results ?? []).map(kr => (
            <span key={kr.id} className="cd-obj-kr">
              <span className="cd-obj-kr-num">
                <span className="cd-obj-kr-cur">{kr.current_value}</span>
                <span className="cd-obj-kr-tgt"> / {kr.target_value}{kr.unit ? ` ${kr.unit}` : ''}</span>
              </span>
            </span>
          ))}
        </div>
      </div>
      <div className="cd-obj-owner">
        <Avatar person={o.owner ?? null} size={26} />
      </div>
    </a>
  )
}

function TaskRow({
  t,
  onToggle,
}: {
  t: Task
  onToggle: (id: string, done: boolean) => void
}) {
  const [done, setDone] = useState(t.done)

  async function handleToggle() {
    const next = !done
    setDone(next)
    try {
      await onToggle(t.id, next)
    } catch {
      setDone(done) // revert
    }
  }

  return (
    <li className={'cd-task ' + (done ? 'is-done' : '')}>
      <button
        className="cd-task-check"
        onClick={handleToggle}
        type="button"
        aria-label={done ? 'Mark incomplete' : 'Mark complete'}
      >
        {done && <Icon name="check" size={11} />}
      </button>
      <span className="cd-task-title">{t.title}</span>
      {t.objective_label && (
        <span className="cd-task-link">
          <Icon name="target" size={10} /> {t.objective_label}
        </span>
      )}
      <span className="cd-task-due">{t.due_label}</span>
    </li>
  )
}

function RetroCol({ label, tone, items }: { label: string; tone: string; items: string[] }) {
  return (
    <div className={`cd-retro-col cd-retro-${tone}`}>
      <div className="cd-retro-lbl">{label}</div>
      <ul>
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  )
}

function HappinessTrack({ values }: { values: (number | null)[] }) {
  const vals = values.filter((v): v is number => v != null)
  if (vals.length === 0) return null
  return (
    <div className="cd-happy">
      {vals.map((v, i) => (
        <div
          key={i}
          className="cd-happy-bar"
          style={{ height: (v / 10 * 100) + '%', background: confidenceColor(v) }}
          title={`${v}/10`}
        />
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

interface Retro {
  id: string
  unit_id: string
  week_number: number
  year: number
  start_items: string[]
  stop_items: string[]
  continue_items: string[]
}

export function DashboardPage() {
  usePageTitle('Dashboard')
  const navigate       = useNavigate()
  const { user, profile } = useAuth()
  const { activeCycle }   = useCycle()
  const { isReviewing, selfAssessmentDue, reviewClosesAt, cycleLabel } = useReviewCycle()

  const me      = profile ? profileToPerson(profile) : null
  const quarter = activeCycle ? parseInt(activeCycle.label.replace(/[^1-4]/g, '')) || 1 : 1
  const cycleYear = activeCycle
    ? parseInt(activeCycle.label.replace(/\D+(\d{4}).*/, '$1')) || new Date().getFullYear()
    : new Date().getFullYear()

  const [period, setPeriod]             = useState<Period>('week')
  const [tasks, setTasks]               = useState<Task[]>([])
  const [nextMeeting, setNextMeeting]   = useState<OneOnOne | null>(null)
  const [lastMeeting, setLastMeeting]   = useState<OneOnOne | null>(null)
  const [happinessVals, setHappiness]   = useState<(number | null)[]>([])
  const [retro, setRetro]               = useState<Retro | null>(null)
  const [primaryUnit, setPrimaryUnit]   = useState<{ id: string; name: string } | null>(null)
  const [hasCheckedIn, setHasCheckedIn] = useState(false)
  const [orgAvg, setOrgAvg]             = useState<string>('—')
  const [addingTask, setAddingTask]     = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const addInputRef = useRef<HTMLInputElement>(null)

  const { objectives } = useCadenceObjectives(activeCycle?.id ?? null, quarter, cycleYear)
  const weekIdx = getCurrentWeekIdx(quarter)

  const myObjs: CadenceObjective[] = objectives.filter(o =>
    o.owner_id === user?.id ||
    (o.key_results ?? []).some(kr => kr.owner_id === user?.id),
  )

  // Compute org confidence avg for current week
  useEffect(() => {
    const vals = objectives
      .map(o => o.confidence[weekIdx])
      .filter((v): v is number => v != null)
    if (vals.length === 0) return
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length
    setOrgAvg(avg.toFixed(1))
  }, [objectives, weekIdx])

  // Parallel data fetches
  useEffect(() => {
    if (!user?.id) return
    const week = getISOWeek(new Date())
    const year = new Date().getFullYear()

    // Tasks
    supabase
      .from('tasks')
      .select('*')
      .eq('owner_id', user.id)
      .order('due_date', { ascending: true })
      .then(({ data }) => setTasks((data ?? []) as Task[]))

    // 1:1s
    supabase
      .from('one_on_ones')
      .select(`
        id, manager_id, report_id, scheduled_at, status, done, happiness, summary,
        next_date:meeting_date,
        report:profiles!report_id(id, full_name, avatar_url, color, job_title),
        manager:profiles!manager_id(id, full_name, avatar_url, color, job_title),
        entry:one_on_one_entries(happiness)
      `)
      .or(`manager_id.eq.${user.id},report_id.eq.${user.id}`)
      .order('scheduled_at', { ascending: false })
      .then(({ data }) => {
        const rows = (data ?? []) as any[]
        const toPerson = (p: any): Person | null => {
          if (!p) return null
          const parts = (p.full_name ?? '').trim().split(/\s+/)
          const initials = parts.slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? '').join('')
          return { id: p.id, name: p.full_name ?? '—', role: p.job_title ?? '', initials, color: p.color ?? '#888', avatar_url: p.avatar_url }
        }
        const shaped: OneOnOne[] = rows.map(r => ({
          ...r,
          manager: toPerson(r.manager),
          report:  toPerson(r.report),
          entry: Array.isArray(r.entry) ? (r.entry[0] ?? null) : (r.entry ?? null),
        }))
        const next = shaped.find(m => !m.done) ?? null
        const last = shaped.filter(m => m.done)[0] ?? null
        setNextMeeting(next)
        setLastMeeting(last)

        // Happiness track from entries
        const happyVals = rows
          .filter(r => r.done)
          .map(r => {
            const e = Array.isArray(r.entry) ? r.entry[0] : r.entry
            return e?.happiness ?? r.happiness ?? null
          })
          .filter((v): v is number => v != null)
          .slice(0, 6)
        setHappiness(happyVals)
      })

    // Check-in status
    supabase
      .from('checkins')
      .select('id')
      .eq('person_id', user.id)
      .eq('week_number', week)
      .eq('year', year)
      .limit(1)
      .then(({ data }) => setHasCheckedIn((data ?? []).length > 0))

    // Primary unit
    supabase
      .from('people_units')
      .select('unit_id, unit:units(id, name)')
      .eq('person_id', user.id)
      .eq('is_primary', true)
      .limit(1)
      .then(({ data }) => {
        const row = (data ?? [])[0] as any
        if (row?.unit) setPrimaryUnit(row.unit)
      })
  }, [user?.id])

  // Retro — load once we know the primary unit
  useEffect(() => {
    if (!primaryUnit) return
    const prevWeek = getISOWeek(new Date()) - 1
    const year = new Date().getFullYear()
    supabase
      .from('retros')
      .select('*')
      .eq('unit_id', primaryUnit.id)
      .eq('year', prevWeek <= 0 ? year - 1 : year)
      .order('week_number', { ascending: false })
      .limit(1)
      .then(({ data }) => setRetro((data ?? [])[0] as Retro ?? null))
  }, [primaryUnit])

  // Computed for the eyebrow — use cycle start/end dates for accuracy
  const weeksInQ = activeCycle?.start_date && activeCycle?.end_date
    ? Math.max(1, Math.round((new Date(activeCycle.end_date).getTime() - new Date(activeCycle.start_date).getTime()) / (7 * 24 * 60 * 60 * 1000)))
    : 13
  const weekOfQ = activeCycle?.start_date
    ? Math.max(1, Math.min(weeksInQ, Math.floor((Date.now() - new Date(activeCycle.start_date).getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1))
    : 1
  const eyebrow = activeCycle
    ? `${activeCycle.label} · Week ${weekOfQ} of ${weeksInQ}`
    : undefined

  const daysLeft = reviewClosesAt
    ? Math.ceil((new Date(reviewClosesAt).getTime() - Date.now()) / 86_400_000)
    : null

  const visibleTasks = filterByPeriod(tasks, period)
  const doneTasks    = tasks.filter(t => t.done)

  // Add task inline
  async function commitAddTask() {
    const title = newTaskTitle.trim()
    if (!title || !user?.id) { setAddingTask(false); setNewTaskTitle(''); return }
    const task = await addQuickTask(title, user.id, endOfWeek())
    setTasks(prev => [...prev, task])
    setNewTaskTitle('')
    setAddingTask(false)
  }

  function handleAddKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commitAddTask()
    if (e.key === 'Escape') { setAddingTask(false); setNewTaskTitle('') }
  }

  function startAdding() {
    setAddingTask(true)
    setTimeout(() => addInputRef.current?.focus(), 0)
  }

  async function handleToggle(id: string, done: boolean) {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done } : t))
    await toggleTask(id, done)
  }

  // Other person in a 1:1
  function otherPerson(m: OneOnOne): Person | null {
    return m.manager_id === user?.id ? (m.report ?? null) : (m.manager ?? null)
  }

  if (!user) return null

  return (
    <div className="cd-page">
      <PageHeader
        eyebrow={eyebrow}
        title={`${greeting()}, ${me?.name?.split(' ')[0] ?? 'there'}.`}
        sub={
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span>{`Org confidence sits at ${orgAvg}/10 · ${eyebrow ?? ''}`}</span>
            {hasCheckedIn
              ? <span style={{ color: 'var(--green)', fontSize: 12 }}>✓ Check-in submitted this week</span>
              : <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                  Update your key results to keep the team aligned.{' '}
                  <button
                    className="cd-link"
                    onClick={() => navigate('/check-in')}
                    type="button"
                  >
                    Check-in takes 2 minutes.
                  </button>
                </span>
            }
          </span>
        }
        actions={
          <Segmented<Period>
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'day',  label: 'Day'     },
              { value: 'week', label: 'Week'    },
              { value: 'q',    label: 'Quarter' },
            ]}
          />
        }
      />

      {/* Review banner */}
      {isReviewing && selfAssessmentDue && (
        <div
          className="cd-rev-banner"
          onClick={() => navigate('/review')}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && navigate('/review')}
        >
          <Icon name="flag" size={14} />
          <span>
            <strong>{cycleLabel} review is open</strong>
            {daysLeft != null && daysLeft >= 0
              ? ` — ${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining to score your OKRs`
              : ' — score your OKRs now'}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 12 }}>Go to review →</span>
        </div>
      )}

      <div className="cd-grid">

        {/* ── My objectives ─────────────────────────────────────── span 8 */}
        <div className="cd-span-8">
          <Card>
            <CardHeader
              title="My objectives & key results"
              sub="Where I'm accountable"
              action={
                <a className="cd-link" href="#" onClick={e => { e.preventDefault(); navigate('/okrs') }}>
                  View all <Icon name="chevronR" size={12} />
                </a>
              }
            />
            <div className="cd-obj-list">
              {myObjs.length === 0 && (
                <div className="cd-empty" style={{ padding: '16px 0' }}>
                  No objectives this cycle.
                </div>
              )}
              {myObjs.map(o => (
                <ObjectiveRow key={o.id} o={o} weekIdx={weekIdx} />
              ))}
            </div>
          </Card>
        </div>

        {/* ── Next 1:1 ──────────────────────────────────────────── span 4 */}
        <div className="cd-span-4">
          <Card>
            <CardHeader title="Next 1:1" sub="In your calendar" />
            {nextMeeting ? (
              <div className="cd-meeting">
                <div className="cd-meeting-hd">
                  <Avatar person={otherPerson(nextMeeting)} size={36} />
                  <div>
                    <div className="cd-meeting-name">{otherPerson(nextMeeting)?.name ?? '—'}</div>
                    <div className="cd-meeting-meta">{otherPerson(nextMeeting)?.role ?? ''}</div>
                  </div>
                </div>
                {nextMeeting.scheduled_at && (
                  <div className="cd-meeting-when">
                    <Icon name="calendar" size={14} />
                    <span>
                      {new Date(nextMeeting.scheduled_at).toLocaleDateString('en-GB', {
                        weekday: 'short', day: 'numeric', month: 'short',
                      })}
                    </span>
                  </div>
                )}
                {lastMeeting && (
                  <div className="cd-meeting-prev">
                    <div className="cd-meeting-prev-lbl">Last time</div>
                    {lastMeeting.summary && <p>"{lastMeeting.summary}"</p>}
                    {happinessVals.length > 0 && (
                      <div className="cd-meeting-prev-foot">
                        <span>Happiness</span>
                        <HappinessTrack values={happinessVals} />
                      </div>
                    )}
                  </div>
                )}
                <button
                  className="cd-btn cd-btn-secondary cd-btn-block"
                  onClick={() => navigate('/1on1s')}
                >
                  Open agenda <Icon name="chevronR" size={12} />
                </button>
              </div>
            ) : (
              <div className="cd-empty" style={{ padding: '16px 0' }}>
                No upcoming 1:1s.
              </div>
            )}
          </Card>
        </div>

        {/* ── Tasks ─────────────────────────────────────────────── span 7 */}
        <div className="cd-span-7">
          <Card>
            <CardHeader
              title="This week"
              sub="Tasks tied to your OKRs"
              action={
                <button className="cd-btn-icon" title="Add task" onClick={startAdding}>
                  <Icon name="plus" size={14} />
                </button>
              }
            />
            <ul className="cd-task-list">
              {visibleTasks.map(t => (
                <TaskRow key={t.id} t={t} onToggle={handleToggle} />
              ))}
              {/* Also show tasks done this week */}
              {doneTasks.slice(0, 3).map(t => (
                <TaskRow key={t.id} t={t} onToggle={handleToggle} />
              ))}
              {addingTask && (
                <li className="cd-task" style={{ paddingLeft: 0 }}>
                  <input
                    ref={addInputRef}
                    className="cd-input"
                    style={{ flex: 1, height: 28, fontSize: 13 }}
                    placeholder="New task title…"
                    value={newTaskTitle}
                    onChange={e => setNewTaskTitle(e.target.value)}
                    onKeyDown={handleAddKeyDown}
                    onBlur={commitAddTask}
                  />
                </li>
              )}
              {visibleTasks.length === 0 && !addingTask && (
                <li style={{ padding: '12px 0', color: 'var(--ink-faint)', fontSize: 13 }}>
                  All done 🎉
                </li>
              )}
            </ul>
          </Card>
        </div>

        {/* ── Retro ─────────────────────────────────────────────── span 5 */}
        <div className="cd-span-5">
          <Card>
            <CardHeader
              title="Last week's retro"
              sub={retro ? `${primaryUnit?.name ?? 'Team'} · W${retro.week_number}` : (primaryUnit?.name ?? 'Team')}
              action={
                <a
                  className="cd-link"
                  href="#"
                  onClick={e => { e.preventDefault(); navigate('/retro') }}
                >
                  Open <Icon name="chevronR" size={12} />
                </a>
              }
            />
            {retro ? (
              <div className="cd-retro">
                <RetroCol label="Start"    tone="ok"   items={retro.start_items.slice(0, 2)} />
                <RetroCol label="Stop"     tone="bad"  items={retro.stop_items.slice(0, 2)} />
                <RetroCol label="Continue" tone="warm" items={retro.continue_items.slice(0, 2)} />
              </div>
            ) : (
              <div className="cd-empty" style={{ padding: '16px 0', flexDirection: 'column', gap: 10 }}>
                <span>No retro last week.</span>
                <button className="cd-btn cd-btn-secondary" onClick={() => navigate('/retro')}>
                  Start retro
                </button>
              </div>
            )}
          </Card>
        </div>

      </div>
    </div>
  )
}
