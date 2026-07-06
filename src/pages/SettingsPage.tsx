import { useState } from 'react'
import { getErrorMessage } from '../lib/errors'
import { useAuth } from '../context/AuthContext'
import { useTeams } from '../hooks/useTeams'
import { profilesService } from '../services/profiles.service'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { Button } from '../components/ui/Button'
import { Avatar } from '../components/ui/Avatar'

export function SettingsPage() {
  const { profile, refreshProfile } = useAuth()
  const { teams } = useTeams()
  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [teamId, setTeamId] = useState(profile?.team_id ?? '')
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const teamOptions = teams.map((t) => ({ value: t.id, label: t.name }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return
    setLoading(true)
    setError('')
    setSaved(false)
    try {
      await profilesService.update(profile.id, {
        full_name: fullName,
        team_id: teamId || null,
      })
      await refreshProfile()
      setSaved(true)
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  if (!profile) return null

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your profile</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 max-w-md">
        <div className="flex items-center gap-4 mb-6 pb-6 border-b border-gray-100">
          <Avatar name={profile.full_name} src={profile.avatar_url} size="lg" />
          <div>
            <p className="text-sm font-semibold text-gray-900">{profile.full_name}</p>
            <p className="text-xs text-gray-500 mt-0.5">Profile photo from Gravatar</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Input
            label="Full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
          <Select
            label="Team"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            options={teamOptions}
            placeholder="No team"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          {saved && <p className="text-sm text-green-600">Changes saved!</p>}
          <div className="flex justify-end">
            <Button type="submit" loading={loading}>Save changes</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
