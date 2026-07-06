import { useState } from 'react'
import { getErrorMessage } from '../../lib/errors'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../components/cadence/Icon'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

export function ProfileSetupPage() {
  const { user, profile, refreshProfile } = useAuth()
  const navigate = useNavigate()

  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [jobTitle, setJobTitle] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!fullName.trim()) { setError('Full name is required'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (password !== confirmPw) { setError('Passwords do not match'); return }
    if (!user) return

    setLoading(true)
    setError('')
    try {
      // Set password on auth user
      const { error: pwErr } = await supabase.auth.updateUser({ password })
      if (pwErr) throw new Error(pwErr.message)

      // Update profile
      const { error: profErr } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          job_title: jobTitle.trim() || null,
          status: 'active',
          must_change_password: false,
        })
        .eq('id', user.id)

      if (profErr) throw new Error(profErr.message)

      await refreshProfile()
      navigate('/dashboard')
    } catch (err) {
      setError(getErrorMessage(err))
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
        <h1 className="cd-auth-title">Complete your profile</h1>
        <p className="cd-auth-sub">
          You've been invited to join your team. Set up your account to get started.
        </p>

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
            <label className="cd-label" htmlFor="title">Job title <span style={{ color: 'var(--ink-faint)', fontWeight: 400 }}>(optional)</span></label>
            <input
              id="title"
              className="cd-input"
              value={jobTitle}
              onChange={e => setJobTitle(e.target.value)}
              placeholder="e.g. Product Manager"
            />
          </div>
          <div className="cd-field">
            <label className="cd-label" htmlFor="password">Create password</label>
            <input
              id="password"
              className="cd-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              required
            />
          </div>
          <div className="cd-field">
            <label className="cd-label" htmlFor="confirm">Confirm password</label>
            <input
              id="confirm"
              className="cd-input"
              type="password"
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              placeholder="Repeat password"
              required
            />
          </div>
          {error && <p className="cd-auth-error">{error}</p>}
          <button
            className="cd-btn cd-btn--primary cd-btn--full"
            type="submit"
            disabled={loading}
          >
            {loading ? 'Setting up…' : 'Go to dashboard'}
          </button>
        </form>
      </div>
    </div>
  )
}
