import { useCallback, useEffect, useState } from 'react'
import { objectivesService } from '../services/objectives.service'
import type { Objective, CreateObjectiveInput, UpdateObjectiveInput } from '../types'
import { useAuth } from '../context/AuthContext'

export function useObjectives(cycleId: string | null, unitId?: string | null) {
  const [objectives, setObjectives] = useState<Objective[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const fetch = useCallback(async () => {
    if (!cycleId) return
    setLoading(true)
    setError(null)
    try {
      const data = await objectivesService.getByCycle(cycleId, unitId)
      setObjectives(data)
    } catch (e) {
      setError(e as Error)
    } finally {
      setLoading(false)
    }
  }, [cycleId, unitId])

  useEffect(() => { fetch() }, [fetch])

  const { user } = useAuth()

  async function createObjective(input: CreateObjectiveInput): Promise<Objective> {
    if (!user) throw new Error('Not authenticated')
    const obj = await objectivesService.create({ ...input, owner_id: user.id })
    setObjectives((prev) => [obj, ...prev])
    return obj
  }

  async function updateObjective(id: string, input: UpdateObjectiveInput): Promise<void> {
    const updated = await objectivesService.update(id, input)
    setObjectives((prev) => prev.map((o) => (o.id === id ? updated : o)))
  }

  async function deleteObjective(id: string): Promise<void> {
    await objectivesService.delete(id)
    setObjectives((prev) => prev.filter((o) => o.id !== id))
  }

  return { objectives, loading, error, createObjective, updateObjective, deleteObjective, refetch: fetch }
}

export function useMyObjectives(cycleId: string | null) {
  const { user } = useAuth()
  const [objectives, setObjectives] = useState<Objective[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const fetch = useCallback(async () => {
    if (!cycleId || !user) return
    setLoading(true)
    setError(null)
    try {
      const data = await objectivesService.getByOwner(cycleId, user.id)
      setObjectives(data)
    } catch (e) {
      setError(e as Error)
    } finally {
      setLoading(false)
    }
  }, [cycleId, user])

  useEffect(() => { fetch() }, [fetch])

  return { objectives, loading, error, refetch: fetch }
}
