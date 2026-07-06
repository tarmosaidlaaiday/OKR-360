import { useState } from 'react'
import { getErrorMessage } from '../../lib/errors'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../../components/cadence/Icon'
import { useAuth } from '../../context/AuthContext'

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

export function RegisterPage() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const strength = passwordStrength(password)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    setError('')
    try {
      await signUp(email, password, fullName)
      navigate('/onboarding')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="cd-auth-screen">
      <Link to="/" className="cd-auth-back">← Back to home</Link>
      <div className="cd-auth-card">
        <Link to="/" className="cd-auth-brand">
          <Icon name="sparkle" size={28} />
          <span className="cd-auth-brand-name">OKR 360</span>
        </Link>
        <h1 className="cd-auth-title">Create your account</h1>
        <p className="cd-auth-sub">Start your 14-day free trial — no credit card needed</p>

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
            <label className="cd-label" htmlFor="email">Work email</label>
            <input
              id="email"
              className="cd-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="jane@company.com"
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
              placeholder="Min. 8 characters"
              required
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
          {error && <p className="cd-auth-error">{error}</p>}
          <button className="cd-btn cd-btn--primary cd-btn--full" type="submit" disabled={loading}>
            {loading ? 'Creating account…' : 'Get started'}
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
