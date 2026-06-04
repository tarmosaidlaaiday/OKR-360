import { createContext, useContext, useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { profilesService } from '../services/profiles.service'
import type { Profile } from '../types'

interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  orgId: string | null
  loading: boolean
  mustChangePassword: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, fullName: string) => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadProfile(userId: string) {
    const p = await profilesService.getById(userId)
    setProfile(p)
    // Touch last_active on session start (fire-and-forget)
    void supabase.rpc('touch_last_active')
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setUser(data.session?.user ?? null)
      if (data.session?.user) {
        loadProfile(data.session.user.id).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess)
      setUser(sess?.user ?? null)
      if (sess?.user) {
        // Keep loading=true until profile arrives so ProtectedRoute never
        // sees session=set + profile=null + loading=false (which triggers
        // a spurious redirect to /onboarding for existing users).
        setLoading(true)
        loadProfile(sess.user.id).finally(() => setLoading(false))
      } else {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  async function signUp(email: string, password: string, fullName: string) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    })
    if (error) throw error
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  async function refreshProfile() {
    if (user) await loadProfile(user.id)
  }

  const mustChangePassword = profile?.must_change_password ?? false
  const orgId = profile?.org_id ?? null

  return (
    <AuthContext.Provider
      value={{ session, user, profile, orgId, loading, mustChangePassword, signIn, signUp, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
