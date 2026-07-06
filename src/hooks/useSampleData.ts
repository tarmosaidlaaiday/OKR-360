import { useEffect, useState } from 'react'
import { getErrorMessage } from '../lib/errors'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export function useSampleData() {
  const { user, orgId } = useAuth()
  const [hasSampleData, setHasSampleData] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)

  useEffect(() => {
    if (!user || !orgId) return
    supabase.rpc('my_org_has_sample_data').then(({ data }) => {
      setHasSampleData(data === true)
    })
  }, [user, orgId])

  async function clearSampleData(): Promise<void> {
    setClearing(true)
    setClearError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/clear-sample-data`
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      })

      const text = await resp.text()
      let json: any
      try { json = JSON.parse(text) } catch {
        throw new Error(`Edge function error (${resp.status}): ${text.slice(0, 200)}`)
      }
      if (json.error) throw new Error(json.error)

      setHasSampleData(false)
    } catch (err) {
      const msg = getErrorMessage(err)
      setClearError(msg)
      throw err
    } finally {
      setClearing(false)
    }
  }

  return { hasSampleData, clearing, clearError, clearSampleData }
}
