import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
  BarChart, Bar, Cell, LabelList,
  PieChart, Pie,
} from 'recharts'
import { useAuth } from '../context/AuthContext'
import { useCycle } from '../context/CycleContext'
import { supabase } from '../lib/supabase'
import { PageHeader } from '../components/cadence/PageHeader'
import { Card, CardHeader } from '../components/cadence/Card'
import { Icon } from '../components/cadence/Icon'
import { getISOWeek } from '../lib/cadenceUtils'
import { EmptyState } from '../components/cadence/EmptyState'
import { usePageTitle } from '../hooks/usePageTitle'
import { isOrgOrUnitAdmin } from '../services/permissions.service'

// ── Types ─────────────────────────────────────────────────────────────────

interface Analytics {
  orgConfidence: number
  checkInRate: { submitted: number; total: number }
  alignmentRate: number
  kpiHealth: { onTrack: number; atRisk: number; offPlan: number }
  weeklyConf: { week: number; unit_id: string; avg_conf: number }[]
  teamCheckIns: { unit_name: string; total_members: number; submitted: number }[]
  cycleHistory: { label: string; score: number }[]
  alignment: { level: number; level_name: string; aligned: number; total: number }[]
  unaligned: { id: string; title: string }[]
  leaderboard: {
    unit_name: string
    member_count: number
    avg_conf: number
    ci_rate: number
    aligned_objs: number
    total_objs: number
  }[]
}

// ── Color helpers ─────────────────────────────────────────────────────────

const UNIT_COLORS  = ['#6366f1', '#8b5cf6', '#3b82f6', '#22c55e', '#f97316', '#ec4899']

function rateColor(rate: number): string {
  if (rate >= 80) return '#1F7A4D'
  if (rate >= 50) return '#9A6A11'
  return '#B23A3A'
}

function scoreColor(score: number): string {
  if (score >= 0.7) return '#1F7A4D'
  if (score >= 0.3) return '#9A6A11'
  return '#B23A3A'
}

// ── Sub-components ────────────────────────────────────────────────────────

function StatCard({ label, value, hint, tone }: {
  label: string; value: string; hint?: string; tone?: 'ok' | 'bad'
}) {
  return (
    <div className={'cd-stat' + (tone ? ` cd-stat-${tone}` : '')}>
      <span className="cd-stat-label">{label}</span>
      <span className="cd-stat-value">{value}</span>
      {hint && <span className="cd-stat-hint" style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{hint}</span>}
    </div>
  )
}

function AlignmentBar({ aligned, total, label, isLast = false }: {
  aligned: number; total: number; label: string; isLast?: boolean
}) {
  const pct = total > 0 ? Math.round((aligned / total) * 100) : 0
  const color = pct === 100 ? '#1F7A4D' : pct >= 70 ? '#9A6A11' : '#B23A3A'
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6,
      padding: '10px 16px',
      borderBottom: isLast ? 'none' : '0.5px solid var(--line)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-mid)' }}>
        <span>{label}</span>
        <span>{aligned}/{total} aligned</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.4s' }} />
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

export function AnalyticsPage() {
  usePageTitle('Analytics')
  const { user }  = useAuth()
  const { activeCycle, cycles, setActiveCycle } = useCycle()
  const navigate  = useNavigate()

  const [data, setData]         = useState<Analytics | null>(null)
  const [loading, setLoading]   = useState(true)
  const [isAdmin, setIsAdmin]   = useState(false)
  const [unalignedOpen, setUnalignedOpen] = useState(false)

  const currentWeek = getISOWeek(new Date())

  // Check admin — uses shared helper so global admins are correctly included
  useEffect(() => {
    if (!user?.id) return
    isOrgOrUnitAdmin(user.id).then(setIsAdmin)
  }, [user?.id])

  // Load analytics from RPC
  useEffect(() => {
    if (!user?.id || !activeCycle?.id) return
    setLoading(true)
    ;(async () => {
      try {
        const { data: rpcData } = await supabase
          .rpc('get_analytics', { p_cycle_id: activeCycle.id, p_viewer_id: user.id })
        if (rpcData) setData(rpcData as Analytics)
      } finally {
        setLoading(false)
      }
    })()
  }, [user?.id, activeCycle?.id])

  // Pivot weeklyConf for recharts: [{week, unitA, unitB, ...}]
  const weeklyConfPivot = (() => {
    if (!data?.weeklyConf) return []
    const byWeek: Record<number, Record<string, number>> = {}
    const unitNames: string[] = []
    for (const row of data.weeklyConf) {
      if (!byWeek[row.week]) byWeek[row.week] = {}
      byWeek[row.week][row.unit_id] = row.avg_conf
      if (!unitNames.includes(row.unit_id)) unitNames.push(row.unit_id)
    }
    // Fill in the current cycle's weeks
    const weeks = Object.keys(byWeek).map(Number).sort()
    return weeks.map(w => ({ week: `W${w}`, ...byWeek[w] }))
  })()

  const weeklyConfUnits = data?.weeklyConf
    ? [...new Set(data.weeklyConf.map(r => r.unit_id))]
    : []

  // Org average line for confidence chart
  const orgAvgLine = weeklyConfPivot.map(row => {
    const anyRow = row as Record<string, unknown>
    const vals = weeklyConfUnits
      .map(u => anyRow[u] as number | undefined)
      .filter((v): v is number => v !== null && v !== undefined)
    return {
      week: row.week,
      avg: vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null,
    }
  })

  // Check-in chart data
  const teamCiData = (data?.teamCheckIns ?? []).map(t => ({
    name: t.unit_name,
    rate: t.total_members > 0 ? Math.round((t.submitted / t.total_members) * 100) : 0,
  }))

  // Cycle history
  const cycleHistData = (data?.cycleHistory ?? []).map(c => ({
    name: c.label,
    score: +(c.score ?? 0).toFixed(2),
  }))

  // KPI health pie
  const kpiPieData = data ? [
    { name: 'On track', value: data.kpiHealth.onTrack,  fill: '#1F7A4D' },
    { name: 'At risk',  value: data.kpiHealth.atRisk,   fill: '#9A6A11' },
    { name: 'Off plan', value: data.kpiHealth.offPlan,  fill: '#B23A3A' },
  ].filter(d => d.value > 0) : []

  const ciRate   = data ? Math.round(data.checkInRate.submitted / Math.max(data.checkInRate.total, 1) * 100) : 0
  const ciGaps   = data ? data.checkInRate.total - data.checkInRate.submitted : 0

  return (
    <div className="cd-page">
      <PageHeader
        eyebrow={`${new Date().getFullYear()} · Analytics`}
        title="How are we tracking?"
        sub="Cycle health, confidence trends, and team performance in one view."
        actions={
          <>
            <select
              className="cd-input"
              style={{ height: 32, fontSize: 13, padding: '0 8px' }}
              value={activeCycle?.id ?? ''}
              onChange={e => {
                const c = cycles.find(c => c.id === e.target.value)
                if (c) setActiveCycle(c)
              }}
            >
              {cycles.map(c => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            <button className="cd-btn cd-btn-secondary" onClick={() => window.print()}>
              Export PDF
            </button>
          </>
        }
      />

      {loading && (
        <div className="cd-empty" style={{ margin: '40px 0' }}>
          <Icon name="retro" size={16} />
          <span>Loading analytics…</span>
        </div>
      )}

      {!loading && data && (
        <>
          {/* ── Summary stats ──────────────────────────────────────── */}
          <div className="cd-okrs-summary" style={{ marginBottom: 'var(--d-gap-grid)' }}>
            <StatCard
              label="Org confidence"
              value={data.orgConfidence ? `${data.orgConfidence}/10` : '—'}
              hint="Avg across active KRs"
              tone={data.orgConfidence >= 7 ? 'ok' : data.orgConfidence >= 4 ? undefined : 'bad'}
            />
            <StatCard
              label="Check-in rate"
              value={`${ciRate}%`}
              hint={`${data.checkInRate.submitted} of ${data.checkInRate.total} checked in · W${currentWeek}`}
              tone={ciRate >= 80 ? 'ok' : ciRate < 50 ? 'bad' : undefined}
            />
            <StatCard
              label="OKRs aligned"
              value={`${data.alignmentRate}%`}
              hint={`${ciGaps > 0 ? ciGaps + ' gap' + (ciGaps !== 1 ? 's' : '') + ' remaining' : 'All objectives aligned'}`}
              tone={data.alignmentRate === 100 ? 'ok' : data.alignmentRate < 70 ? 'bad' : undefined}
            />
            <StatCard
              label="KPI health"
              value={`${data.kpiHealth.onTrack}/${data.kpiHealth.onTrack + data.kpiHealth.atRisk + data.kpiHealth.offPlan}`}
              hint="On track this cycle"
              tone={data.kpiHealth.offPlan === 0 ? 'ok' : undefined}
            />
          </div>

          {/* ── Section 1: Confidence trend ────────────────────────── */}
          <div style={{ marginBottom: 'var(--d-gap-grid)' }}><Card>
            <CardHeader
              title={`Weekly confidence · ${activeCycle?.label ?? ''}`}
              sub="Avg confidence per team by ISO week"
            />
            {weeklyConfPivot.length === 0 ? (
              <EmptyState
                icon="clock"
                title="No check-in data yet"
                description="Check-ins will appear here once your team starts submitting weekly updates"
              />
            ) : (
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weeklyConfPivot} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis dataKey="week" tick={{ fontSize: 11, fill: 'var(--ink-faint)' }} />
                    <YAxis domain={[0, 10]} tick={{ fontSize: 11, fill: 'var(--ink-faint)' }} />
                    <Tooltip
                      contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {weeklyConfUnits.map((unit, i) => (
                      <Line
                        key={unit}
                        dataKey={unit}
                        stroke={UNIT_COLORS[i % UNIT_COLORS.length]}
                        dot={false}
                        strokeWidth={1.5}
                      />
                    ))}
                    {/* Org average as dashed line */}
                    <Line
                      data={orgAvgLine}
                      dataKey="avg"
                      name="Org avg"
                      stroke="var(--ink-mid)"
                      strokeDasharray="5 4"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card></div>

          {/* ── Section 2: Two columns ─────────────────────────────── */}
          <div className="cd-grid" style={{ marginBottom: 'var(--d-gap-grid)' }}>

            {/* Check-in completion — 7 cols */}
            <div className="cd-span-7">
              <Card>
                <CardHeader title="Check-in completion by team" sub={`W${currentWeek} · this week`} />
                {teamCiData.length === 0 ? (
                  <EmptyState icon="users" title="No team data" />
                ) : (
                  <div style={{ height: Math.max(160, teamCiData.length * 36 + 20) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={teamCiData}
                        layout="vertical"
                        margin={{ top: 8, right: 16, left: 100, bottom: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" horizontal={false} />
                        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--ink-faint)' }} unit="%" />
                        <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: 'var(--ink-faint)' }} width={100} />
                        <Tooltip
                          formatter={(v: unknown) => [`${v}%`, 'Rate']}
                          contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }}
                        />
                        <Bar dataKey="rate" radius={[0, 3, 3, 0]}>
                          {teamCiData.map((entry, i) => (
                            <Cell key={i} fill={rateColor(entry.rate)} />
                          ))}
                          <LabelList dataKey="rate" position="right" formatter={(v: unknown) => `${v}%`} style={{ fontSize: 11, fill: 'var(--ink-mid)' }} />
                        </Bar>
                        <ReferenceLine x={80} stroke="#1F7A4D" strokeDasharray="4 2" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>
            </div>

            {/* Cycle comparison — 5 cols */}
            <div className="cd-span-5">
              <Card>
                <CardHeader title="Cycle comparison" sub="Avg objective score" />
                {cycleHistData.length === 0 ? (
                  <EmptyState
                    icon="calendar"
                    title="No previous cycles"
                    description="Cycle comparison will appear after you complete your first review"
                  />
                ) : (
                  <div style={{ height: 200 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={cycleHistData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--ink-faint)' }} />
                        <YAxis domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tick={{ fontSize: 11, fill: 'var(--ink-faint)' }} />
                        <Tooltip
                          formatter={(v: unknown) => [`${Math.round((v as number) * 100)}%`, 'Score']}
                          contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }}
                        />
                        <ReferenceLine y={0.7} stroke="#1F7A4D" strokeDasharray="4 2" label={{ value: 'sweet spot', position: 'insideRight', fontSize: 10, fill: '#1F7A4D' }} />
                        <Bar dataKey="score" radius={[3, 3, 0, 0]}>
                          {cycleHistData.map((entry, i) => (
                            <Cell key={i} fill={scoreColor(entry.score)} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>
            </div>
          </div>

          {/* ── Section 3: Two columns ─────────────────────────────── */}
          <div className="cd-grid" style={{ marginBottom: 'var(--d-gap-grid)' }}>

            {/* Alignment health — 6 cols */}
            <div className="cd-span-7">
              <Card>
                <div style={{ borderBottom: '0.5px solid var(--line)' }}>
                  <CardHeader
                    title="Alignment health"
                    sub="% of objectives with a parent"
                    action={
                      <a className="cd-link" href="#" onClick={e => { e.preventDefault(); navigate('/cascade') }}>
                        Cascade view <Icon name="chevronR" size={12} />
                      </a>
                    }
                  />
                </div>
                {(data.alignment ?? []).length === 0 ? (
                  <AlignmentBar label="All objectives" aligned={data.alignmentRate} total={100} isLast />
                ) : (
                  <>
                    {data.alignment.map((row, i) => (
                      <AlignmentBar
                        key={row.level}
                        label={row.level_name}
                        aligned={row.aligned}
                        total={row.total}
                        isLast={i === data.alignment.length - 1}
                      />
                    ))}
                  </>
                )}
                {data.unaligned.length > 0 && (
                  <div style={{ borderTop: '0.5px solid var(--line)', padding: '10px 16px 16px', marginTop: 4 }}>
                    <button
                      className="cd-link"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}
                      onClick={() => setUnalignedOpen(o => !o)}
                    >
                      <Icon name={unalignedOpen ? 'chevron' : 'chevronR'} size={12} />
                      {data.unaligned.length} unaligned objective{data.unaligned.length !== 1 ? 's' : ''}
                    </button>
                    {unalignedOpen && (
                      <ul style={{ margin: '8px 0 0', padding: '0 0 0 16px', listStyle: 'disc', fontSize: 12, color: 'var(--ink-mid)' }}>
                        {data.unaligned.map(o => (
                          <li key={o.id} style={{ marginBottom: 4 }}>
                            <a className="cd-link" href="#" onClick={e => { e.preventDefault(); navigate('/cascade') }}>
                              {o.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </Card>
            </div>

            {/* KPI health donut — 5 cols */}
            <div className="cd-span-5">
              <Card>
                <CardHeader title="KPI health snapshot" sub="This cycle" />
                {kpiPieData.length === 0 ? (
                  <EmptyState icon="chart-bar" title="No KPI data" description="Add KPIs to see health snapshot" />
                ) : (
                  <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ResponsiveContainer width="60%" height="100%">
                      <PieChart>
                        <Pie
                          data={kpiPieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={44}
                          outerRadius={70}
                          dataKey="value"
                          paddingAngle={2}
                        >
                          {kpiPieData.map((entry, i) => (
                            <Cell key={i} fill={entry.fill} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                      {kpiPieData.map(d => (
                        <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, background: d.fill, flexShrink: 0 }} />
                          <span style={{ color: 'var(--ink-mid)' }}>{d.name}</span>
                          <span style={{ fontFamily: 'monospace', fontWeight: 600, marginLeft: 'auto', paddingLeft: 8 }}>{d.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            </div>
          </div>

          {/* ── Section 4: Team leaderboard (admin only) ───────────── */}
          {isAdmin && data.leaderboard.length > 0 && (
            <Card>
              <CardHeader title="Team leaderboard" sub="Unit performance this cycle" />
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--line)' }}>
                      {['Unit', 'Members', 'Avg confidence', 'Check-in rate', 'OKRs aligned'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '6px 12px', fontSize: 11, color: 'var(--ink-faint)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.leaderboard.map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 500 }}>{row.unit_name}</td>
                        <td style={{ padding: '8px 12px', color: 'var(--ink-mid)' }}>{row.member_count}</td>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: row.avg_conf >= 7 ? '#1F7A4D' : row.avg_conf >= 4 ? 'var(--ink)' : '#B23A3A' }}>
                          {row.avg_conf ? `${+row.avg_conf.toFixed(1)}/10` : '—'}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{ color: rateColor(row.ci_rate) }}>
                            {row.ci_rate ?? 0}%
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', color: 'var(--ink-mid)' }}>
                          {row.aligned_objs}/{row.total_objs}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
