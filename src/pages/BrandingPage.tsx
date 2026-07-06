import { useState, useRef } from 'react'
import { getErrorMessage } from '../lib/errors'
import { useOrg } from '../context/OrgContext'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const SWATCHES = [
  '#5D5BE6', '#6366f1', '#8b5cf6', '#ec4899',
  '#ef4444', '#f97316', '#22c55e', '#0ea5e9',
  '#14b8a6', '#64748b',
]

export function BrandingPage() {
  const { org, updateOrg } = useOrg()
  const { orgId } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)

  const [orgName, setOrgName]       = useState(org?.name ?? '')
  const [color, setColor]           = useState(org?.primary_color ?? '#5D5BE6')
  const [hexInput, setHexInput]     = useState(org?.primary_color ?? '#5D5BE6')
  const [logoPreview, setLogoPreview] = useState<string | null>(org?.logo_url ?? null)
  const [saving, setSaving]         = useState(false)
  const [uploading, setUploading]   = useState(false)
  const [saved, setSaved]           = useState(false)
  const [error, setError]           = useState('')

  async function handleSaveName() {
    if (!orgName.trim()) return
    setSaving(true)
    setError('')
    try {
      await updateOrg({ name: orgName.trim() })
      flashSaved()
    } catch {
      setError('Failed to save name')
    } finally {
      setSaving(false)
    }
  }

  async function handleColorSelect(c: string) {
    setColor(c)
    setHexInput(c)
    await updateOrg({ primary_color: c })
    flashSaved()
  }

  async function handleHexCommit() {
    const clean = hexInput.trim()
    if (!/^#[0-9a-fA-F]{6}$/.test(clean)) return
    setColor(clean)
    await updateOrg({ primary_color: clean })
    flashSaved()
  }

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !orgId) return

    // Preview immediately
    const reader = new FileReader()
    reader.onload = ev => setLogoPreview(ev.target?.result as string)
    reader.readAsDataURL(file)

    setUploading(true)
    setError('')
    try {
      const ext = file.name.split('.').pop()
      const path = `${orgId}/logo.${ext}`
      const { error: upErr } = await supabase.storage
        .from('org-logos')
        .upload(path, file, { upsert: true })
      if (upErr) throw new Error(upErr.message)

      const { data } = supabase.storage.from('org-logos').getPublicUrl(path)
      await updateOrg({ logo_url: data.publicUrl })
      flashSaved()
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setUploading(false)
    }
  }

  async function handleRemoveLogo() {
    setLogoPreview(null)
    await updateOrg({ logo_url: null })
    flashSaved()
  }

  function flashSaved() {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const initials = (org?.name ?? orgName ?? 'O')
    .split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()

  return (
    <div className="cd-branding-page">

      {/* Logo */}
      <section className="cd-branding-section">
        <h3 className="cd-branding-section-title">Logo</h3>
        <div className="cd-branding-logo-row">
          <div className="cd-branding-logo-preview" style={{ background: logoPreview ? 'transparent' : color }}>
            {logoPreview
              ? <img src={logoPreview} alt="Logo" />
              : <span>{initials}</span>
            }
          </div>
          <div className="cd-branding-logo-actions">
            <button
              className="cd-btn cd-btn--ghost cd-btn--sm"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? 'Uploading…' : 'Upload logo'}
            </button>
            {logoPreview && (
              <button className="cd-btn cd-btn--ghost cd-btn--sm" onClick={handleRemoveLogo}>
                Remove
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoChange} />
            <p className="cd-branding-logo-hint">PNG or SVG, square, min 64×64px</p>
          </div>
        </div>
      </section>

      {/* Org name */}
      <section className="cd-branding-section">
        <h3 className="cd-branding-section-title">Organisation name</h3>
        <div className="cd-branding-name-row">
          <input
            className="cd-input"
            value={orgName}
            onChange={e => setOrgName(e.target.value)}
            onBlur={handleSaveName}
            onKeyDown={e => e.key === 'Enter' && handleSaveName()}
            placeholder="Acme Corp"
          />
          <button
            className="cd-btn cd-btn--primary cd-btn--sm"
            onClick={handleSaveName}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </section>

      {/* Brand colour */}
      <section className="cd-branding-section">
        <h3 className="cd-branding-section-title">Brand colour</h3>
        <div className="cd-branding-swatches">
          {SWATCHES.map(s => (
            <button
              key={s}
              type="button"
              className={'cd-branding-swatch' + (color === s ? ' is-sel' : '')}
              style={{ background: s }}
              onClick={() => handleColorSelect(s)}
              title={s}
            />
          ))}
        </div>
        <div className="cd-branding-hex-row">
          <div className="cd-branding-hex-preview" style={{ background: hexInput }} />
          <input
            className="cd-input cd-branding-hex-input"
            value={hexInput}
            onChange={e => setHexInput(e.target.value)}
            onBlur={handleHexCommit}
            onKeyDown={e => e.key === 'Enter' && handleHexCommit()}
            placeholder="#5D5BE6"
            maxLength={7}
          />
        </div>
      </section>

      {error && <p className="cd-auth-error">{error}</p>}
      {saved && <p className="cd-branding-saved">Saved</p>}
    </div>
  )
}
