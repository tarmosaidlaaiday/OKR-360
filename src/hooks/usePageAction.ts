import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePageActionStore } from '../stores/pageActionStore'

export type PageAction = {
  label: string
  icon: 'plus'
  onClick: () => void
} | null

function useCanCreate() {
  const { profile } = useAuth()
  const isAdmin = (profile as any)?.is_global_admin ?? false

  return function canCreate(resource: string): boolean {
    if (isAdmin) return true
    // Members can create objectives, check-ins, and 1:1s
    return ['objective', 'checkin', '1on1'].includes(resource)
  }
}

export function usePageAction(): PageAction {
  const location = useLocation()
  const navigate = useNavigate()
  const tab = new URLSearchParams(location.search).get('tab')
  const { pathname } = location

  const store = usePageActionStore()
  const canCreate = useCanCreate()

  if (pathname === '/dashboard') {
    if (!canCreate('checkin')) return null
    return {
      label: 'Check-in',
      icon: 'plus',
      onClick: () => navigate('/check-in'),
    }
  }

  if (pathname === '/objectives') {
    if (!canCreate('objective')) return null
    return {
      label: 'Add objective',
      icon: 'plus',
      onClick: () => store.setObjectivesModalOpen(true),
    }
  }

  if (pathname === '/kpis') {
    if (!canCreate('kpi')) return null
    return {
      label: 'Add KPI',
      icon: 'plus',
      onClick: () => store.setKpiModalOpen(true),
    }
  }

  if (pathname === '/people') {
    if (tab === 'scorecards') return null
    if (!canCreate('1on1')) return null
    return {
      label: 'New 1:1',
      icon: 'plus',
      onClick: () => store.setNewMeetingOpen(true),
    }
  }

  if (pathname === '/settings/structure') {
    if (!canCreate('unit')) return null
    return {
      label: 'Add unit',
      icon: 'plus',
      onClick: () => store.setAddUnitOpen(true),
    }
  }

  if (pathname === '/settings/users') {
    if (!canCreate('user')) return null
    return {
      label: 'Add user',
      icon: 'plus',
      onClick: () => store.setAddUserOpen(true),
    }
  }

  return null
}
