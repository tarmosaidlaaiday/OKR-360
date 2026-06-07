import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../../components/cadence/Icon'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// ── Types ──────────────────────────────────────────────────────────────────

type Step = 'org' | 'structure' | 'invite' | 'choice'

interface OrgDraft {
  name: string
  industry: string
  size: string
}

const INDUSTRIES = [
  'Technology', 'Finance', 'Healthcare', 'Retail', 'Manufacturing',
  'Education', 'Media', 'Consulting', 'Non-profit', 'Other',
]

const SIZES = [
  { value: '1-10',    label: '1–10 people' },
  { value: '11-50',   label: '11–50 people' },
  { value: '51-200',  label: '51–200 people' },
  { value: '201-500', label: '201–500 people' },
  { value: '500+',    label: '500+ people' },
]

const STEP_ORDER: Step[] = ['org', 'structure', 'invite', 'choice']

// ── Helpers ────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) + '-' + Math.random().toString(36).slice(2, 6)
}

// ── Step components ────────────────────────────────────────────────────────

function StepOrg({ draft, onChange, onNext, loading, error }: {
  draft: OrgDraft
  onChange: (d: Partial<OrgDraft>) => void
  onNext: () => void
  loading: boolean
  error: string
}) {
  return (
    <div className="cd-onboard-step">
      <h2 className="cd-onboard-step-title">Tell us about your organisation</h2>
      <p className="cd-onboard-step-sub">This sets up your workspace. You can change details later.</p>

      <div className="cd-field">
        <label className="cd-label">Organisation name</label>
        <input
          className="cd-input"
          value={draft.name}
          onChange={e => onChange({ name: e.target.value })}
          placeholder="Acme Corp"
          autoFocus
          required
        />
      </div>

      <div className="cd-field">
        <label className="cd-label">Industry</label>
        <select className="cd-input" value={draft.industry} onChange={e => onChange({ industry: e.target.value })}>
          <option value="">Select industry…</option>
          {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
        </select>
      </div>

      <div className="cd-field">
        <label className="cd-label">Company size</label>
        <div className="cd-onboard-size-grid">
          {SIZES.map(s => (
            <button
              key={s.value}
              type="button"
              className={`cd-onboard-size-btn ${draft.size === s.value ? 'is-sel' : ''}`}
              onClick={() => onChange({ size: s.value })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="cd-auth-error">{error}</p>}

      <button
        className="cd-btn cd-btn--primary cd-btn--full cd-onboard-cta"
        disabled={!draft.name.trim() || loading}
        onClick={onNext}
      >
        {loading ? 'Setting up…' : 'Continue'}
      </button>
    </div>
  )
}

function StepStructure({ onNext, onSkip, orgName }: { onNext: (units: string[]) => void; onSkip: () => void; orgName: string }) {
  const [units, setUnits] = useState([orgName || ''])

  function updateUnit(i: number, val: string) {
    setUnits(prev => prev.map((u, idx) => idx === i ? val : u))
  }
  function addUnit() { setUnits(prev => [...prev, '']) }
  function removeUnit(i: number) { setUnits(prev => prev.filter((_, idx) => idx !== i)) }

  return (
    <div className="cd-onboard-step">
      <h2 className="cd-onboard-step-title">Add your top-level teams</h2>
      <p className="cd-onboard-step-sub">e.g. Engineering, Marketing, Sales. You can add more later.</p>

      <div className="cd-onboard-unit-list">
        {units.map((u, i) => (
          <div key={i} className="cd-onboard-unit-row">
            <input
              className="cd-input"
              value={u}
              onChange={e => updateUnit(i, e.target.value)}
              placeholder={`Team ${i + 1}`}
            />
            {units.length > 1 && (
              <button type="button" className="cd-icon-btn" onClick={() => removeUnit(i)}>
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
        ))}
        <button type="button" className="cd-btn cd-btn--ghost" onClick={addUnit}>
          + Add team
        </button>
      </div>

      <div className="cd-onboard-actions">
        <button className="cd-btn cd-btn--primary" onClick={() => onNext(units.filter(u => u.trim()))}>
          Continue
        </button>
        <button className="cd-btn cd-btn--ghost" onClick={onSkip}>
          Skip for now
        </button>
      </div>
    </div>
  )
}

function StepInvite({ onNext, onSkip }: { onNext: (emails: string[]) => void; onSkip: () => void }) {
  const [emails, setEmails] = useState([''])

  function updateEmail(i: number, val: string) {
    setEmails(prev => prev.map((e, idx) => idx === i ? val : e))
  }
  function addEmail() { setEmails(prev => [...prev, '']) }
  function removeEmail(i: number) { setEmails(prev => prev.filter((_, idx) => idx !== i)) }

  return (
    <div className="cd-onboard-step">
      <h2 className="cd-onboard-step-title">Invite your team</h2>
      <p className="cd-onboard-step-sub">They'll get an invitation email. You can also invite later from Settings → Users.</p>

      <div className="cd-onboard-unit-list">
        {emails.map((e, i) => (
          <div key={i} className="cd-onboard-unit-row">
            <input
              className="cd-input"
              type="email"
              value={e}
              onChange={ev => updateEmail(i, ev.target.value)}
              placeholder="colleague@company.com"
            />
            {emails.length > 1 && (
              <button type="button" className="cd-icon-btn" onClick={() => removeEmail(i)}>
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
        ))}
        <button type="button" className="cd-btn cd-btn--ghost" onClick={addEmail}>
          + Add another
        </button>
      </div>

      <div className="cd-onboard-actions">
        <button
          className="cd-btn cd-btn--primary"
          onClick={() => onNext(emails.filter(e => e.trim() && e.includes('@')))}
        >
          Continue
        </button>
        <button className="cd-btn cd-btn--ghost" onClick={onSkip}>
          Skip for now
        </button>
      </div>
    </div>
  )
}

function StepChoice({ loading, error, onChoiceSample, onChoiceScratch }: {
  loading: boolean
  error: string
  onChoiceSample: () => void
  onChoiceScratch: () => void
}) {
  return (
    <div className="cd-onboard-step">
      <h2 className="cd-onboard-step-title">How would you like to start?</h2>
      <p className="cd-onboard-step-sub">You can replace any sample content with your real goals at any time.</p>

      <div className="cd-onboard-choice-grid">
        <button
          type="button"
          className="cd-onboard-choice-card"
          onClick={onChoiceSample}
          disabled={loading}
        >
          <div className="cd-onboard-choice-icon">
            <Icon name="target" size={22} />
          </div>
          <div className="cd-onboard-choice-title">Load sample data</div>
          <div className="cd-onboard-choice-desc">
            See OKR 360 with realistic OKRs, KPIs, and check-in history already filled in.
            Replace it with your real goals any time.
          </div>
          {loading && <div className="cd-onboard-choice-loading">Generating…</div>}
        </button>

        <button
          type="button"
          className="cd-onboard-choice-card"
          onClick={onChoiceScratch}
          disabled={loading}
        >
          <div className="cd-onboard-choice-icon">
            <Icon name="sparkle" size={22} />
          </div>
          <div className="cd-onboard-choice-title">Start from scratch</div>
          <div className="cd-onboard-choice-desc">
            Jump straight in with a blank workspace and create your own objectives from day one.
          </div>
        </button>
      </div>

      {error && <p className="cd-auth-error">{error}</p>}
    </div>
  )
}

// ── Progress dots ─────────────────────────────────────────────────────────

function ProgressDots({ step }: { step: Step }) {
  const cur = STEP_ORDER.indexOf(step)
  const displaySteps = STEP_ORDER.filter(s => s !== 'choice')
  return (
    <div className="cd-onboard-dots">
      {displaySteps.map((s, i) => (
        <div
          key={s}
          className={`cd-onboard-dot ${i < cur ? 'is-done' : ''} ${i === cur ? 'is-cur' : ''}`}
        />
      ))}
    </div>
  )
}

// ── Main wizard ────────────────────────────────────────────────────────────

export function OnboardingWizard() {
  const { user, orgId: existingOrgId, refreshProfile } = useAuth()
  const navigate = useNavigate()

  // If user already has an org (e.g. re-visiting), skip to choice
  const [step, setStep] = useState<Step>(existingOrgId ? 'choice' : 'org')
  const [orgDraft, setOrgDraft] = useState<OrgDraft>({ name: '', industry: '', size: '' })
  const [orgId, setOrgId] = useState<string | null>(existingOrgId)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // ── Step 1: create org + assign to profile ─────────────────────────────

  async function handleOrgNext() {
    if (!user) return
    setLoading(true)
    setError('')
    try {
      // Pre-generate the org ID so we never need to SELECT back the
      // just-inserted row. The org_select policy uses my_org_id(), which
      // returns NULL until the profile UPDATE below runs — so chaining
      // .select().single() on the insert would be blocked by RLS.
      const newOrgId = crypto.randomUUID()

      const { error: orgErr } = await supabase
        .from('organisations')
        .insert({
          id: newOrgId,
          name: orgDraft.name.trim(),
          slug: slugify(orgDraft.name.trim()),
          industry: orgDraft.industry || null,
          size: orgDraft.size || null,
          plan: 'trial',
          created_by: user.id,
        })

      if (orgErr) throw new Error(`Org insert: ${orgErr.message}`)

      const { error: profErr } = await supabase
        .from('profiles')
        .update({ org_id: newOrgId, is_global_admin: true })
        .eq('id', user.id)

      if (profErr) throw new Error(`Profile update: ${profErr.message}`)

      // Verify org_id actually saved — RLS on profiles UPDATE uses
      // auth.uid() = id which should always pass, but confirm it stuck.
      const { data: check } = await supabase
        .from('profiles')
        .select('org_id')
        .eq('id', user.id)
        .single()
      if (!check?.org_id) throw new Error('org_id still null after update — check profiles RLS UPDATE policy')

      setOrgId(newOrgId)
      await refreshProfile()
      setStep('structure')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create organisation')
    } finally {
      setLoading(false)
    }
  }

  // ── Step 2: create top-level units ─────────────────────────────────────

  async function handleStructureNext(unitNames: string[]) {
    if (orgId && unitNames.length > 0) {
      await supabase.from('units').insert(
        unitNames.map(name => ({ name, org_id: orgId, parent_id: null }))
      )
    }
    setStep('invite')
  }

  // ── Step 3: queue invite emails ────────────────────────────────────────

  async function handleInviteNext(emails: string[]) {
    if (orgId && emails.length > 0) {
      void Promise.all(emails.map(email =>
        supabase.from('notifications').insert({
          person_id: user!.id,
          type: 'invite_pending',
          title: `Invitation queued for ${email}`,
          body: `Pending invite for ${email} in org ${orgId}`,
        })
      ))
    }
    setStep('choice')
  }

  // ── Step 4a: load sample data ──────────────────────────────────────────

  async function handleChoiceSample() {
    if (!orgId) return
    setLoading(true)
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-sample-data`
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ org_id: orgId }),
      })

      const text = await resp.text()
      let json: any
      try { json = JSON.parse(text) } catch {
        throw new Error(`Edge function error (${resp.status}): ${text.slice(0, 200)}`)
      }
      if (json.error) throw new Error(json.error)

      navigate('/dashboard')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate sample data')
      setLoading(false)
    }
  }

  // ── Step 4b: start from scratch ────────────────────────────────────────

  function handleChoiceScratch() {
    navigate('/dashboard')
  }

  async function handleCancel() {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <div className="cd-auth-screen">
      <div className="cd-onboard-card">
        <Link to="/" className="cd-auth-brand" style={{ marginBottom: 4 }}>
          <Icon name="sparkle" size={24} />
          <span className="cd-auth-brand-name" style={{ fontSize: 16 }}>OKR 360</span>
        </Link>

        {step !== 'choice' && <ProgressDots step={step} />}

        {step === 'org' && (
          <StepOrg
            draft={orgDraft}
            onChange={p => setOrgDraft(d => ({ ...d, ...p }))}
            onNext={handleOrgNext}
            loading={loading}
            error={error}
          />
        )}
        {step === 'structure' && (
          <StepStructure onNext={handleStructureNext} onSkip={() => setStep('invite')} orgName={orgDraft.name} />
        )}
        {step === 'invite' && (
          <StepInvite onNext={handleInviteNext} onSkip={() => setStep('choice')} />
        )}
        {step === 'choice' && (
          <StepChoice
            loading={loading}
            error={error}
            onChoiceSample={handleChoiceSample}
            onChoiceScratch={handleChoiceScratch}
          />
        )}

        {/* Only show cancel on the first step — org not yet created */}
        {step === 'org' && (
          <button
            type="button"
            onClick={handleCancel}
            className="cd-onboard-cancel"
          >
            Cancel setup
          </button>
        )}
      </div>
    </div>
  )
}
