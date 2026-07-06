import { useEffect, useState } from 'react'
import { getErrorMessage } from '../../lib/errors'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../../components/cadence/Icon'
import { supabase } from '../../lib/supabase'

function passwordStrength(pw: string): { score: number; label: string } {
  let score = 0
  if (pw.length >= 8)  score++
  if (pw.length >= 12) score++
  if (/[A-Z]/.test(pw)) score++
  if (/[0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong']
  return { score, label: labels[score] ?? '' }
}

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [sessionReady, setSessionReady] = useState(false)
  const [password, setPassword]         = useState('')
  const [confirm, setConfirm]           = useState('')
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState('')
  const [done, setDone]                 = useState(false)

  const strength = passwordStrength(password)

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setSessionReady(true)
      }
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }
    setLoading(true)
    setError('')
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      setDone(true)
      setTimeout(() => navigate('/dashboard'), 2000)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="cd-auth-screen">
      <Link to="/login" className="cd-auth-back">← Back to sign in</Link>
      <div className="cd-auth-card">
        <Link to="/" className="cd-auth-brand">
          <Icon name="sparkle" size={28} />
          <span className="cd-auth-brand-name">OKR 360</span>
        </Link>
        <h1 className="cd-auth-title">Set your new password</h1>
        <p className="cd-auth-sub">Choose a strong password for your account</p>

        {done ? (
          <p className="cd-auth-sub" style={{ color: 'var(--ok)', marginTop: 24 }}>
            Password updated. Redirecting…
          </p>
        ) : !sessionReady ? (
          <p className="cd-auth-sub" style={{ marginTop: 24 }}>
            Verifying your reset link…
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="cd-auth-form">
            <div className="cd-field">
              <label className="cd-label" htmlFor="password">New password</label>
              <input
                id="password"
                className="cd-input"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                required
                autoFocus
              />
              {password.length > 0 && (
                <div className="cd-pw-strength">
                  <div className="cd-pw-bars">
                    {[1,2,3,4,5].map(i => (
                      <div
                        key={i}
                        className={`cd-pw-bar ${i <= strength.score ? `cd-pw-bar--${strength.score <= 2 ? 'weak' : strength.score <= 3 ? 'fair' : 'strong'}` : ''}`}
                      />
                    ))}
                  </div>
                  <span className="cd-pw-label">{strength.label}</span>
                </div>
              )}
            </div>
            <div className="cd-field">
              <label className="cd-label" htmlFor="confirm">Confirm password</label>
              <input
                id="confirm"
                className="cd-input"
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Repeat your new password"
                required
              />
            </div>
            {error && <p className="cd-auth-error">{error}</p>}
            <button className="cd-btn cd-btn--primary cd-btn--full" type="submit" disabled={loading}>
              {loading ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
