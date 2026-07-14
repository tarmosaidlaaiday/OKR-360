import { useState, useEffect, useRef } from 'react'
import { getErrorMessage } from '../lib/errors'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { PageHeader } from '../components/cadence/PageHeader'
import { Icon } from '../components/cadence/Icon'
import { Avatar } from '../components/cadence/Avatar'
import { profileToPerson } from '../lib/cadenceUtils'
import { profilesService } from '../services/profiles.service'
import {
  getPreferences, upsertPreference,
  type NotificationPreference,
} from '../services/notifications.service'
import type { AppNotification } from '../types/cadence'

// ── Password strength ─────────────────────────────────────────────────────

function passwordStrength(pw: string): { label: string; color: string; score: number } {
  if (pw.length < 8) return { label: 'Too short', color: 'var(--bad)', score: 0 }
  let score = 0
  if (pw.length >= 10) score++
  if (/[A-Z]/.test(pw)) score++
  if (/[0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  if (score <= 1) return { label: 'Weak',   color: 'var(--bad)',  score: 1 }
  if (score === 2) return { label: 'Fair',   color: 'var(--warn)', score: 2 }
  return                        { label: 'Strong', color: 'var(--ok)',   score: 3 }
}

function PasswordInput({ id, value, onChange, placeholder, showStrength }: {
  id: string; value: string; onChange: (v: string) => void
  placeholder?: string; showStrength?: boolean
}) {
  const [show, setShow] = useState(false)
  const strength = showStrength && value ? passwordStrength(value) : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ position: 'relative' }}>
        <input
          id={id} className="cd-input"
          type={show ? 'text' : 'password'}
          value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder ?? '••••••••'}
          style={{ paddingRight: 40 }} autoComplete="new-password"
        />
        <button type="button" onClick={() => setShow(s => !s)}
          style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--ink-soft)' }}
          tabIndex={-1}>
          <Icon name={show ? 'eyeOff' : 'eye'} size={16} />
        </button>
      </div>
      {showStrength && value && strength && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 3, flex: 1 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ flex: 1, height: 3, borderRadius: 2,
                background: i <= strength.score ? strength.color : 'var(--line)', transition: 'background .2s' }} />
            ))}
          </div>
          <span style={{ fontSize: 11, color: strength.color, whiteSpace: 'nowrap' }}>{strength.label}</span>
        </div>
      )}
    </div>
  )
}

// ── Notification types ────────────────────────────────────────────────────

const NOTIF_TYPES: { type: AppNotification['type']; label: string; description: string }[] = [
  { type: 'checkin_due',      label: 'Check-in due',       description: 'Monday reminder when your KRs are ready for weekly update.' },
  { type: 'checkin_reminder', label: 'Check-in reminder',  description: 'Wednesday nudge if you haven\'t checked in yet.' },
  { type: 'blocker_flagged',  label: 'Blocker flagged',    description: 'When a team member flags a blocker in their check-in (leads only).' },
  { type: 'nudge',            label: 'Nudge from lead',    description: 'When your team lead sends you a manual nudge.' },
  { type: 'review_open',      label: 'Review cycle open',  description: 'When a self-assessment review cycle begins.' },
  { type: 'cycle_archived',   label: 'Cycle archived',     description: 'When a cycle is locked and final scores are published.' },
  { type: 'okr_unaligned',    label: 'Unaligned OKR',      description: 'When your objective has no parent link in an active cycle.' },
  { type: 'invite_accepted',  label: 'Invite accepted',    description: 'When someone you invited joins the workspace.' },
]

// ── Page ──────────────────────────────────────────────────────────────────

export function AccountPage() {
  const { user, profile, refreshProfile } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)

  // ── Profile section ──
  const [fullName, setFullName]       = useState(profile?.full_name ?? '')
  const [avatarPreview, setAvatarPreview] = useState<string | null>(profile?.avatar_url ?? null)
  const [profileSaving, setProfileSaving] = useState(false)
  const [uploading, setUploading]     = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileSaved, setProfileSaved] = useState(false)

  // keep form in sync if profile loads after mount
  useEffect(() => {
    if (profile?.full_name) setFullName(profile.full_name)
    if (profile?.avatar_url !== undefined) setAvatarPreview(profile.avatar_url ?? null)
  }, [profile?.id])

  function flashProfileSaved() {
    setProfileSaved(true)
    setTimeout(() => setProfileSaved(false), 2000)
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !profile?.id) return

    // Optimistic preview
    const reader = new FileReader()
    reader.onload = ev => setAvatarPreview(ev.target?.result as string)
    reader.readAsDataURL(file)

    setUploading(true)
    setProfileError('')
    try {
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `${profile.id}/avatar.${ext}`
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true })
      if (upErr) throw new Error(upErr.message)

      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      await profilesService.update(profile.id, { avatar_url: data.publicUrl })
      await refreshProfile()
      flashProfileSaved()
    } catch (e) {
      setProfileError(getErrorMessage(e))
      setAvatarPreview(profile.avatar_url ?? null)
    } finally {
      setUploading(false)
      // reset so the same file can be re-selected
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleRemoveAvatar() {
    if (!profile?.id) return
    setAvatarPreview(null)
    setProfileError('')
    try {
      await profilesService.update(profile.id, { avatar_url: null })
      await refreshProfile()
      flashProfileSaved()
    } catch (e) {
      setProfileError(getErrorMessage(e))
      setAvatarPreview(profile.avatar_url ?? null)
    }
  }

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault()
    if (!profile?.id || !fullName.trim()) return
    setProfileSaving(true)
    setProfileError('')
    try {
      await profilesService.update(profile.id, { full_name: fullName.trim() })
      await refreshProfile()
      flashProfileSaved()
    } catch (e) {
      setProfileError(getErrorMessage(e))
    } finally {
      setProfileSaving(false)
    }
  }

  // ── Password section ──
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw]         = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwLoading, setPwLoading] = useState(false)
  const [pwError, setPwError]     = useState('')
  const [pwSuccess, setPwSuccess] = useState(false)

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPwError('')
    if (newPw !== confirmPw) { setPwError('New passwords do not match.'); return }
    const strength = passwordStrength(newPw)
    if (strength.score === 0) { setPwError('Password must be at least 8 characters.'); return }
    setPwLoading(true)
    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: user?.email ?? '', password: currentPw,
      })
      if (signInErr) { setPwError('Current password is incorrect.'); return }
      const { error: updateErr } = await supabase.auth.updateUser({ password: newPw })
      if (updateErr) throw updateErr
      if (profile?.id) {
        await supabase.rpc('clear_must_change_password', { p_target_id: profile.id })
        await refreshProfile()
      }
      setPwSuccess(true)
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
    } catch (e) {
      setPwError(getErrorMessage(e))
    } finally {
      setPwLoading(false)
    }
  }

  // ── Notifications section ──
  const [prefs, setPrefs]   = useState<Record<string, boolean>>({})
  const [nLoading, setNLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.id) return
    getPreferences(user.id)
      .then(data => {
        const map: Record<string, boolean> = {}
        for (const p of data as NotificationPreference[]) map[p.type] = p.in_app_enabled
        setPrefs(map)
      })
      .catch(console.error)
      .finally(() => setNLoading(false))
  }, [user?.id])

  async function handleToggle(type: AppNotification['type'], enabled: boolean) {
    if (!user?.id) return
    setPrefs(p => ({ ...p, [type]: enabled }))
    setSaving(type)
    try {
      await upsertPreference(user.id, type, enabled)
    } catch {
      setPrefs(p => ({ ...p, [type]: !enabled }))
    } finally {
      setSaving(null)
    }
  }

  const me = profile ? profileToPerson(profile) : null

  return (
    <div className="cd-page">
      <PageHeader title="Account settings" />

      <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Profile section */}
        <div className="cd-card" style={{ padding: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 20px' }}>Profile</h2>

          {/* Avatar row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid var(--line)' }}>
            {avatarPreview
              ? <img src={avatarPreview} alt={profile?.full_name ?? 'You'} style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
              : <Avatar person={me} size={56} />
            }
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="cd-btn cd-btn--ghost cd-btn--sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? 'Uploading…' : 'Upload photo'}
                </button>
                {avatarPreview && (
                  <button type="button" className="cd-btn cd-btn--ghost cd-btn--sm" onClick={handleRemoveAvatar}>
                    Remove photo
                  </button>
                )}
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: 0 }}>
                {avatarPreview ? 'JPG, PNG or GIF, max 5 MB' : 'No photo — showing initials'}
              </p>
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} />
          </div>

          {/* Full name */}
          <form onSubmit={handleSaveName} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="cd-field">
              <label className="cd-label" htmlFor="acc-full-name">Full name</label>
              <input
                id="acc-full-name"
                className="cd-input"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Your full name"
                required
              />
            </div>
            <div className="cd-field">
              <label className="cd-label">Email</label>
              <input className="cd-input" value={user?.email ?? ''} disabled style={{ opacity: 0.6 }} />
            </div>
            {profileError && <p style={{ fontSize: 13, color: 'var(--bad)', margin: 0 }}>{profileError}</p>}
            {profileSaved && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ok)' }}>
                <Icon name="checkCircle" size={14} />
                Saved
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" className="cd-btn cd-btn--primary" disabled={profileSaving || !fullName.trim()}>
                {profileSaving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>

        {/* Password section */}
        <div className="cd-card" style={{ padding: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 20px' }}>Change password</h2>
          {pwSuccess ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ok)', fontSize: 13 }}>
              <Icon name="checkCircle" size={16} />
              Password updated successfully.
            </div>
          ) : (
            <form onSubmit={handlePasswordSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="cd-field">
                <label className="cd-label" htmlFor="acc-cur-pw">Current password</label>
                <PasswordInput id="acc-cur-pw" value={currentPw} onChange={setCurrentPw} placeholder="Enter current password" />
              </div>
              <div className="cd-field">
                <label className="cd-label" htmlFor="acc-new-pw">New password</label>
                <PasswordInput id="acc-new-pw" value={newPw} onChange={setNewPw} placeholder="At least 8 characters" showStrength />
              </div>
              <div className="cd-field">
                <label className="cd-label" htmlFor="acc-conf-pw">Confirm new password</label>
                <PasswordInput id="acc-conf-pw" value={confirmPw} onChange={setConfirmPw} placeholder="Repeat new password" />
              </div>
              {pwError && <p style={{ fontSize: 13, color: 'var(--bad)', margin: 0 }}>{pwError}</p>}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="submit" className="cd-btn cd-btn--primary" disabled={pwLoading || !newPw || !confirmPw || !currentPw}>
                  {pwLoading ? 'Updating…' : 'Update password'}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Notifications section */}
        <div className="cd-card" style={{ padding: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px' }}>Notification preferences</h2>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '0 0 16px' }}>
            Choose which in-app notifications you receive.
          </p>
          {nLoading ? (
            <p className="cd-loading" style={{ margin: 0 }}>Loading…</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {NOTIF_TYPES.map(config => {
                const enabled = prefs[config.type] !== false
                return (
                  <div key={config.type} style={{
                    display: 'flex', alignItems: 'center', gap: 16,
                    padding: '12px 0',
                    borderBottom: '1px solid var(--line)',
                    opacity: saving === config.type ? 0.6 : 1,
                    transition: 'opacity .1s',
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{config.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>{config.description}</div>
                    </div>
                    <span
                      style={{
                        display: 'inline-flex', alignItems: 'center',
                        width: 36, height: 20, borderRadius: 100,
                        background: enabled ? 'var(--accent)' : 'var(--line)',
                        padding: '2px 3px', transition: 'background .15s', cursor: 'pointer', flexShrink: 0,
                      }}
                      onClick={() => handleToggle(config.type, !enabled)}
                      role="switch" aria-checked={enabled} tabIndex={0}
                      onKeyDown={e => e.key === 'Enter' && handleToggle(config.type, !enabled)}
                    >
                      <span style={{
                        width: 14, height: 14, borderRadius: '50%', background: '#fff',
                        transform: enabled ? 'translateX(16px)' : 'translateX(0)',
                        transition: 'transform .15s', flexShrink: 0,
                      }} />
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
