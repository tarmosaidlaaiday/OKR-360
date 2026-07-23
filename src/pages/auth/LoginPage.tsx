import { useState } from 'react'
import { getErrorMessage } from '../../lib/errors'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../../components/cadence/Icon'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

const RESET_REDIRECT = 'https://okr-360.netlify.app/reset-password'

// Client-side speed bump: exponential backoff after 3 consecutive failures.
// NOTE: the real defence against credential stuffing is server-side rate limiting
// configured in the Supabase dashboard (Auth → Rate limits) — this is a UX-level
// safeguard only and does not replace that setting.
const BACKOFF_DELAYS = [0, 0, 0, 5, 15, 30, 60] // seconds after each failure index

export function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [forgotMode, setForgotMode] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [failCount, setFailCount] = useState(0)
  const [backoffUntil, setBackoffUntil] = useState<number>(0)
  const [backoffSecs, setBackoffSecs] = useState(0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (backoffUntil > Date.now()) return
    setLoading(true)
    setError('')
    try {
      await signIn(email, password)
      navigate('/dashboard')
    } catch {
      const next = failCount + 1
      setFailCount(next)
      const delaySecs = BACKOFF_DELAYS[Math.min(next, BACKOFF_DELAYS.length - 1)]
      if (delaySecs > 0) {
        const until = Date.now() + delaySecs * 1000
        setBackoffUntil(until)
        setBackoffSecs(delaySecs)
        setError(`Too many attempts. Try again in ${delaySecs}s.`)
        const iv = setInterval(() => {
          const remaining = Math.ceil((until - Date.now()) / 1000)
          if (remaining <= 0) {
            clearInterval(iv)
            setBackoffSecs(0)
            setBackoffUntil(0)
            setError('')
          } else {
            setBackoffSecs(remaining)
          }
        }, 1000)
      } else {
        setError('Incorrect email or password.')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: RESET_REDIRECT,
      })
      if (resetError) throw resetError
      setResetSent(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const backoffActive = backoffUntil > Date.now()

  if (forgotMode) {
    return (
      <div className="cd-auth-screen">
        <Link to="/" className="cd-auth-back">← Back to home</Link>
        <div className="cd-auth-card">
          <Link to="/" className="cd-auth-brand">
            <Icon name="sparkle" size={28} />
            <span className="cd-auth-brand-name">OKR 360</span>
          </Link>
          <h1 className="cd-auth-title">Reset password</h1>
          <p className="cd-auth-sub">We'll email you a link to set a new password</p>

          {resetSent ? (
            <p className="cd-auth-sub" style={{ color: 'var(--ok)', marginTop: 24 }}>
              Check your inbox — reset link sent to {email}
            </p>
          ) : (
            <form onSubmit={handleForgot} className="cd-auth-form">
              <div className="cd-field">
                <label className="cd-label" htmlFor="email">Email</label>
                <input
                  id="email"
                  className="cd-input"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  autoFocus
                />
              </div>
              {error && <p className="cd-auth-error">{error}</p>}
              <button className="cd-btn cd-btn--primary cd-btn--full" type="submit" disabled={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          )}

          <p className="cd-auth-foot">
            <button type="button" className="cd-link-btn" onClick={() => { setForgotMode(false); setResetSent(false); setError('') }}>
              ← Back to sign in
            </button>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="cd-auth-screen">
      <Link to="/" className="cd-auth-back">← Back to home</Link>
      <div className="cd-auth-card">
        <Link to="/" className="cd-auth-brand">
          <Icon name="sparkle" size={28} />
          <span className="cd-auth-brand-name">OKR 360</span>
        </Link>
        <h1 className="cd-auth-title">Welcome back</h1>
        <p className="cd-auth-sub">Sign in to your workspace</p>

        <form onSubmit={handleSubmit} className="cd-auth-form">
          <div className="cd-field">
            <label className="cd-label" htmlFor="email">Email</label>
            <input
              id="email"
              className="cd-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoFocus
            />
          </div>
          <div className="cd-field">
            <label className="cd-label" htmlFor="password">Password</label>
            <input
              id="password"
              className="cd-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          {error && <p className="cd-auth-error">{error}</p>}
          <button
            className="cd-btn cd-btn--primary cd-btn--full"
            type="submit"
            disabled={loading || backoffActive}
          >
            {loading ? 'Signing in…' : backoffActive ? `Try again in ${backoffSecs}s` : 'Sign in'}
          </button>
        </form>

        <p className="cd-auth-foot">
          <button type="button" className="cd-link-btn" onClick={() => { setForgotMode(true); setError('') }}>
            Forgot password?
          </button>
        </p>
        <p className="cd-auth-foot">
          No account?{' '}
          <Link to="/register">Create one free</Link>
        </p>
      </div>
    </div>
  )
}
