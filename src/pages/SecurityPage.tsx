import { useState } from 'react'
import { getErrorMessage } from '../lib/errors'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { PageHeader } from '../components/cadence/PageHeader'
import { Icon } from '../components/cadence/Icon'

function passwordStrength(pw: string): { label: string; color: string; score: number } {
  if (pw.length < 8) return { label: 'Too short', color: 'var(--bad)', score: 0 }
  let score = 0
  if (pw.length >= 10) score++
  if (/[A-Z]/.test(pw)) score++
  if (/[0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  if (score <= 1) return { label: 'Weak', color: 'var(--bad)', score: 1 }
  if (score === 2) return { label: 'Fair', color: 'var(--warn)', score: 2 }
  return { label: 'Strong', color: 'var(--ok)', score: 3 }
}

function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  showStrength,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  showStrength?: boolean
}) {
  const [show, setShow] = useState(false)
  const strength = showStrength && value ? passwordStrength(value) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          className="cd-input"
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder ?? '••••••••'}
          style={{ paddingRight: 40 }}
          autoComplete="new-password"
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          style={{
            position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            color: 'var(--ink-soft)',
          }}
          tabIndex={-1}
        >
          <Icon name={show ? 'eyeOff' : 'eye'} size={16} />
        </button>
      </div>
      {showStrength && value && strength && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 3, flex: 1 }}>
            {[1, 2, 3].map(i => (
              <div
                key={i}
                style={{
                  flex: 1, height: 3, borderRadius: 2,
                  background: i <= strength.score ? strength.color : 'var(--line)',
                  transition: 'background 0.2s',
                }}
              />
            ))}
          </div>
          <span style={{ fontSize: 11, color: strength.color, whiteSpace: 'nowrap' }}>
            {strength.label}
          </span>
        </div>
      )}
    </div>
  )
}

export function SecurityPage() {
  const { user, profile, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isForced = searchParams.get('prompt') === 'change'

  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (newPw !== confirmPw) {
      setError('New passwords do not match.')
      return
    }
    const strength = passwordStrength(newPw)
    if (strength.score === 0) {
      setError('Password must be at least 8 characters.')
      return
    }

    setLoading(true)
    try {
      // Re-authenticate with current password first (unless forced first-login)
      if (!isForced && currentPw) {
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: user?.email ?? '',
          password: currentPw,
        })
        if (signInErr) {
          setError('Current password is incorrect.')
          return
        }
      }

      const { error: updateErr } = await supabase.auth.updateUser({ password: newPw })
      if (updateErr) throw updateErr

      // Clear must_change_password flag
      if (profile?.id) {
        await supabase.rpc('clear_must_change_password', { p_target_id: profile.id })
        await refreshProfile()
      }

      setSuccess(true)
      setTimeout(() => navigate('/dashboard'), 1500)
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="cd-page">
        <PageHeader title="Security" />
        <div style={{ maxWidth: 480, margin: '40px auto', textAlign: 'center', padding: '32px 24px' }}>
          <div style={{ color: 'var(--ok)', marginBottom: 12 }}>
            <Icon name="checkCircle" size={40} />
          </div>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>Password updated</p>
          <p style={{ color: 'var(--ink-soft)', fontSize: 13 }}>Redirecting you to the dashboard…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="cd-page">
      <PageHeader title="Security" />

      <div style={{ maxWidth: 480 }}>
        {isForced && (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '12px 16px', borderRadius: 8, marginBottom: 24,
              background: 'color-mix(in srgb, var(--warn) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--warn) 30%, transparent)',
              color: 'var(--warn)', fontSize: 13,
            }}
          >
            <Icon name="alertTriangle" size={16} />
            <span style={{ color: 'var(--ink)' }}>You must set a new password before continuing.</span>
          </div>
        )}

        <div className="cd-card" style={{ padding: '24px' }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 20, marginTop: 0 }}>
            Change password
          </h2>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {!isForced && (
              <div className="cd-field">
                <label className="cd-label" htmlFor="current-pw">Current password</label>
                <PasswordInput
                  id="current-pw"
                  value={currentPw}
                  onChange={setCurrentPw}
                  placeholder="Enter current password"
                />
              </div>
            )}

            <div className="cd-field">
              <label className="cd-label" htmlFor="new-pw">New password</label>
              <PasswordInput
                id="new-pw"
                value={newPw}
                onChange={setNewPw}
                placeholder="At least 8 characters"
                showStrength
              />
            </div>

            <div className="cd-field">
              <label className="cd-label" htmlFor="confirm-pw">Confirm new password</label>
              <PasswordInput
                id="confirm-pw"
                value={confirmPw}
                onChange={setConfirmPw}
                placeholder="Repeat new password"
              />
            </div>

            {error && <p style={{ fontSize: 13, color: 'var(--bad)', margin: 0 }}>{error}</p>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
              {!isForced && (
                <button
                  type="button"
                  className="cd-btn"
                  onClick={() => navigate(-1)}
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                className="cd-btn cd-btn--primary"
                disabled={loading || !newPw || !confirmPw}
              >
                {loading ? 'Updating…' : 'Update password'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
