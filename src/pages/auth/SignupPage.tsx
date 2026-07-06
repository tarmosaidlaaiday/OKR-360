import { useState } from 'react'
import { getErrorMessage } from '../../lib/errors'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../../components/cadence/Icon'
import { useAuth } from '../../context/AuthContext'

export function SignupPage() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    setLoading(true)
    setError('')
    try {
      await signUp(email, password, fullName)
      navigate('/dashboard')
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="cd-auth-screen">
      <div className="cd-auth-card">
        <div className="cd-auth-brand">
          <Icon name="sparkle" size={28} />
          <span className="cd-auth-brand-name">OKR 360</span>
        </div>
        <h1 className="cd-auth-title">Create account</h1>
        <p className="cd-auth-sub">Start your OKR journey</p>

        <form onSubmit={handleSubmit} className="cd-auth-form">
          <div className="cd-field">
            <label className="cd-label" htmlFor="name">Full name</label>
            <input
              id="name"
              className="cd-input"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Jane Smith"
              required
              autoFocus
            />
          </div>
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
              placeholder="Min. 6 characters"
              required
            />
          </div>
          {error && <p className="cd-auth-error">{error}</p>}
          <button className="cd-btn cd-btn--primary cd-btn--full" type="submit" disabled={loading}>
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="cd-auth-foot">
          Already have an account?{' '}
          <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
