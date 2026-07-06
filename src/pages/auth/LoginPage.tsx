import { useState } from 'react'
import { getErrorMessage } from '../../lib/errors'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../../components/cadence/Icon'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

const RESET_REDIRECT = 'https://okr-360.netlify.app/reset-password'

export function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [forgotMode, setForgotMode] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await signIn(email, password)
      navigate('/dashboard')
    } catch {
      setError('Incorrect email or password.')
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
          <button className="cd-btn cd-btn--primary cd-btn--full" type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
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
