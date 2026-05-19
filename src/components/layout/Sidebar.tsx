import { useNavigate, useLocation, NavLink } from 'react-router-dom'
import { Icon } from '../cadence/Icon'
import { Avatar } from '../cadence/Avatar'
import { useAuth } from '../../context/AuthContext'
import { useOrg } from '../../context/OrgContext'
import { profileToPerson } from '../../lib/cadenceUtils'

const MAIN_NAV = [
  { to: '/dashboard',          icon: 'dashboard'   as const, label: 'Dashboard'  },
  { to: '/objectives',         icon: 'checkCircle' as const, label: 'Objectives' },
  { to: '/kpis',               icon: 'chart'       as const, label: 'KPIs'       },
  { to: '/people',             icon: 'users'       as const, label: 'People'     },
  { to: '/analytics',          icon: 'chartLine'   as const, label: 'Analytics'  },
]

const ORG_NAV = [
  { to: '/settings/structure', icon: 'sitemap' as const, label: 'Structure' },
  { to: '/settings/users',     icon: 'users'   as const, label: 'Users'     },
]

// These paths make the parent nav item "active"
const ACTIVE_PREFIXES: Record<string, string[]> = {
  '/objectives': ['/objectives', '/okrs', '/my-focus', '/my-contribution', '/cascade'],
  '/people':     ['/people', '/1on1s', '/scorecard'],
  '/settings/structure': ['/settings/structure', '/cycles', '/settings/my-units'],
}

function useNavActive(to: string): boolean {
  const { pathname } = useLocation()
  const extra = ACTIVE_PREFIXES[to] ?? []
  return pathname === to || pathname.startsWith(to + '?') ||
    extra.some(p => pathname === p || pathname.startsWith(p + '/'))
}

function NavItem({ to, icon, label }: { to: string; icon: Parameters<typeof Icon>[0]['name']; label: string }) {
  const isActive = useNavActive(to)
  return (
    <NavLink
      to={to}
      className={() => 'cd-side-link' + (isActive ? ' is-on' : '')}
      end={false}
    >
      <Icon name={icon} size={16} />
      <span>{label}</span>
    </NavLink>
  )
}

function OrgBrand() {
  const { org } = useOrg()
  const initials = org?.name
    ? org.name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
    : '✦'
  const color = org?.primary_color ?? '#5D5BE6'

  return (
    <div className="cd-side-brand">
      <div className="cd-side-org-logo" style={{ background: org?.logo_url ? 'transparent' : color }}>
        {org?.logo_url
          ? <img src={org.logo_url} alt={org.name} />
          : <span>{initials}</span>
        }
      </div>
      <div className="cd-side-brand-text">
        <div className="cd-side-org-name">{org?.name ?? 'Your Org'}</div>
        <div className="cd-side-product-name">OKR 360</div>
      </div>
    </div>
  )
}

export function Sidebar() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const me = profile ? profileToPerson(profile) : null

  return (
    <nav className="cd-side">
      {/* Brand */}
      <OrgBrand />

      {/* Main nav */}
      <ul className="cd-side-nav" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {MAIN_NAV.map(n => (
          <li key={n.to}><NavItem to={n.to} icon={n.icon} label={n.label} /></li>
        ))}
      </ul>

      {/* Organisation section */}
      <div className="cd-side-group">
        <div className="cd-side-grp-lbl">Organisation</div>
        {ORG_NAV.map(n => (
          <NavItem key={n.to} to={n.to} icon={n.icon} label={n.label} />
        ))}
      </div>

      {/* Footer: avatar + name + role + gear + sign out */}
      <div className="cd-side-foot">
        <Avatar person={me} size={28} />
        <div className="cd-side-foot-text">
          <div className="cd-side-foot-name">{me?.name ?? 'You'}</div>
          <div className="cd-side-foot-role">{me?.role ?? ''}</div>
        </div>
        <button
          className="cd-btn-icon"
          onClick={() => navigate('/settings/account')}
          type="button"
          title="Account settings"
        >
          <Icon name="settings" size={14} />
        </button>
        <button
          className="cd-btn-icon"
          onClick={signOut}
          type="button"
          title="Sign out"
        >
          <Icon name="arrowDown" size={14} />
        </button>
      </div>
    </nav>
  )
}
