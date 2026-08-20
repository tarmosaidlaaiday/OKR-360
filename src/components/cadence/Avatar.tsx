import type { Person } from '../../types/cadence'

function deriveInitials(name: string | null | undefined): string {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map(n => n[0]?.toUpperCase() ?? '').join('')
}

interface AvatarProps {
  person: Person | null | undefined
  size?: number
  ring?: boolean
}

export function Avatar({ person, size = 24, ring = false }: AvatarProps) {
  if (!person) return null
  if (person.avatar_url) {
    return (
      <img
        src={person.avatar_url}
        alt={person.name}
        title={person.name}
        style={{
          width: size, height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
          boxShadow: ring ? '0 0 0 2px var(--bg)' : 'none',
        }}
      />
    )
  }
  return (
    <span
      className="cd-avatar"
      title={person.name}
      style={{
        width: size, height: size,
        fontSize: size * 0.42,
        background: person.color,
        boxShadow: ring ? '0 0 0 2px var(--bg)' : 'none',
      }}
    >
      {person.initials || deriveInitials(person.name)}
    </span>
  )
}

interface AvatarStackProps {
  people: (Person | null | undefined)[]
  size?: number
  max?: number
}

export function AvatarStack({ people, size = 22, max = 4 }: AvatarStackProps) {
  const list = people.filter(Boolean).slice(0, max) as Person[]
  const overflow = people.length - list.length
  return (
    <div className="cd-avstack" style={{ ['--av-size' as string]: size + 'px' }}>
      {list.map(p => <Avatar key={p.id} person={p} size={size} ring />)}
      {overflow > 0 && (
        <span className="cd-avatar cd-avatar-more"
              style={{ width: size, height: size, fontSize: size * 0.38 }}>
          +{overflow}
        </span>
      )}
    </div>
  )
}
