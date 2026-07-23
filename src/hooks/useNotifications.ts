import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { getNotifications, markRead, markAllRead } from '../services/notifications.service'
import type { AppNotification } from '../types/cadence'

export function useNotifications() {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState<AppNotification[]>([])

  const reload = useCallback(async () => {
    if (!user?.id) return
    const data = await getNotifications(user.id).catch(err => { console.error('useNotifications: fetch failed', err); return [] })
    setNotifications(data)
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) return
    reload()

    // Realtime subscription — append new notifications as they arrive
    const channel = supabase
      .channel(`notif:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `person_id=eq.${user.id}`,
        },
        (payload) => {
          setNotifications(prev => [payload.new as AppNotification, ...prev])
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `person_id=eq.${user.id}`,
        },
        (payload) => {
          setNotifications(prev =>
            prev.map(n => n.id === (payload.new as AppNotification).id
              ? (payload.new as AppNotification)
              : n),
          )
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user?.id, reload])

  const handleMarkRead = useCallback(async (id: string) => {
    await markRead(id)
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, read: true, read_at: new Date().toISOString() } : n),
    )
  }, [])

  const handleMarkAllRead = useCallback(async () => {
    if (!user?.id) return
    await markAllRead(user.id)
    const now = new Date().toISOString()
    setNotifications(prev => prev.map(n => ({ ...n, read: true, read_at: now })))
  }, [user?.id])

  const unreadCount = notifications.filter(n => !n.read).length

  return { notifications, unreadCount, markRead: handleMarkRead, markAllRead: handleMarkAllRead, reload }
}
