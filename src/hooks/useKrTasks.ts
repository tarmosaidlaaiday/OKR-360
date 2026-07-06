import { useEffect, useState, useCallback } from 'react'
import {
  getKrTasks, createKrTask, updateKrTask, updateKrTaskStatus, deleteKrTask,
} from '../services/krTasks.service'
import type { KrTask, KrTaskStatus } from '../types/cadence'

export function useKrTasks(keyResultId: string | null, userId: string | null) {
  const [tasks, setTasks] = useState<KrTask[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!keyResultId) { setTasks([]); return }
    setLoading(true)
    getKrTasks(keyResultId)
      .then(setTasks)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [keyResultId])

  const addTask = useCallback(async (
    title: string,
    assigneeId?: string | null,
    dueDate?: string | null,
  ) => {
    if (!keyResultId || !userId) return
    const task = await createKrTask(keyResultId, title, userId, assigneeId, dueDate)
    setTasks(prev => [...prev, task])
  }, [keyResultId, userId])

  const editTask = useCallback(async (
    taskId: string,
    fields: Partial<Pick<KrTask, 'title' | 'assignee_id' | 'due_date'>>,
  ) => {
    await updateKrTask(taskId, fields)
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...fields } : t))
  }, [])

  const updateStatus = useCallback(async (taskId: string, status: KrTaskStatus) => {
    await updateKrTaskStatus(taskId, status)
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status } : t))
  }, [])

  const removeTask = useCallback(async (taskId: string) => {
    await deleteKrTask(taskId)
    setTasks(prev => prev.filter(t => t.id !== taskId))
  }, [])

  return { tasks, loading, addTask, editTask, updateStatus, removeTask }
}
