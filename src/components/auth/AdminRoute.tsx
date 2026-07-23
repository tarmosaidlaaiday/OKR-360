import { useState, useEffect } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { isOrgOrUnitAdmin } from '../../services/permissions.service'
import { PageSpinner } from '../ui/Spinner'

/**
 * Route guard for admin-only pages (Structure, Users, etc.).
 * Checks profile.is_global_admin first (no DB round-trip needed —
 * profile is already loaded by AuthContext), then falls through to
 * isOrgOrUnitAdmin for unit-admin/lead roles.
 * Non-admins are redirected to /dashboard rather than shown an error.
 */
export function AdminRoute() {
  const { user, profile, loading: authLoading } = useAuth()
  const [adminStatus, setAdminStatus] = useState<boolean | null>(null)

  useEffect(() => {
    if (authLoading || !user?.id) return
    // Global admins can skip the extra DB query (profile type doesn't expose is_global_admin)
    if ((profile as any)?.is_global_admin) { setAdminStatus(true); return }
    isOrgOrUnitAdmin(user.id)
      .then(setAdminStatus)
      .catch(err => { console.error('AdminRoute: isOrgOrUnitAdmin failed', err); setAdminStatus(false) })
  }, [user?.id, (profile as any)?.is_global_admin, authLoading])

  if (authLoading || adminStatus === null) return <PageSpinner />
  if (!adminStatus) return <Navigate to="/dashboard" replace />
  return <Outlet />
}
