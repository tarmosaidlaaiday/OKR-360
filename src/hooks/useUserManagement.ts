import { useEffect, useState, useCallback } from 'react'
import { getErrorMessage } from '../lib/errors'
import { useAuth } from '../context/AuthContext'
import {
  listUsers, getAdminScope,
  upsertMembership, removeMembership, setUserStatus, createUser, resetUserPassword, inviteUser,
  type ManagedUser, type UserStatus, type UnitRole, type AdminScope,
} from '../services/userManagement.service'

export function useUserManagement() {
  const { user, profile } = useAuth()
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [scope, setScope] = useState<AdminScope[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isGlobalAdmin = (profile as any)?.is_global_admin ?? false

  const reload = useCallback(async () => {
    if (!user?.id) return
    setLoading(true)
    setError(null)
    try {
      const [fetchedUsers, fetchedScope] = await Promise.all([
        listUsers(),
        getAdminScope(user.id),
      ])
      setUsers(fetchedUsers)
      setScope(fetchedScope)
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => { reload() }, [reload])

  const scopeUnitIds = new Set(scope.map(s => s.unit_id))

  // Which users can the current viewer actually see / manage?
  const visibleUsers = isGlobalAdmin
    ? users
    : users.filter(u =>
        u.id === user?.id ||
        u.memberships.some(m => scopeUnitIds.has(m.unit_id))
      )

  // Can the viewer manage a specific membership unit?
  function canManageUnit(unitId: string): boolean {
    return isGlobalAdmin || scopeUnitIds.has(unitId)
  }

  // Allowed roles a viewer can grant in a unit
  function allowedRoles(): UnitRole[] {
    if (isGlobalAdmin) return ['admin', 'member', 'viewer']
    return ['member', 'viewer']
  }

  async function doUpsertMembership(targetId: string, unitId: string, role: UnitRole, isPrimary?: boolean) {
    await upsertMembership(targetId, unitId, role, isPrimary)
    await reload()
  }

  async function doRemoveMembership(targetId: string, unitId: string) {
    await removeMembership(targetId, unitId)
    await reload()
  }

  async function doSetUserStatus(targetId: string, status: UserStatus) {
    await setUserStatus(targetId, status)
    await reload()
  }

  async function doCreateUser(payload: {
    name: string
    email: string
    password: string
    unit_id: string
    role: UnitRole
    must_change_password: boolean
  }) {
    await createUser(payload)
    await reload()
  }

  async function doResetPassword(personId: string, newPassword: string) {
    await resetUserPassword(personId, newPassword)
  }

  async function doInviteUser(payload: {
    email: string
    unit_id: string
    role: UnitRole
    org_id: string
  }) {
    await inviteUser(payload)
    await reload()
  }

  return {
    users: visibleUsers,
    allUsers: users,
    scope,
    loading,
    error,
    reload,
    isGlobalAdmin,
    canManageUnit,
    allowedRoles,
    upsertMembership: doUpsertMembership,
    removeMembership: doRemoveMembership,
    setUserStatus: doSetUserStatus,
    createUser: doCreateUser,
    inviteUser: doInviteUser,
    resetPassword: doResetPassword,
  }
}
