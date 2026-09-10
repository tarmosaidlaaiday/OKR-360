import type { KeyResult } from '../types'
import type { KrTaskStatus } from '../types/cadence'

export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

export function isOverdue(d: string | null, status: KrTaskStatus): boolean {
  if (!d || status === 'done') return false
  return new Date(d + 'T00:00:00') < new Date(new Date().toDateString())
}

export function computeObjectiveProgress(keyResults: KeyResult[]): number {
  if (!keyResults.length) return 0
  const progresses = keyResults.map((kr) => {
    if (kr.target_type === 'boolean') {
      return kr.current_value >= 1 ? 100 : 0
    }
    if (kr.target_value === 0) return 0
    return Math.min(100, (kr.current_value / kr.target_value) * 100)
  })
  return progresses.reduce((a, b) => a + b, 0) / progresses.length
}

export function formatValue(kr: KeyResult): string {
  if (kr.target_type === 'boolean') {
    return kr.current_value >= 1 ? 'Done' : 'Not done'
  }
  const unit = kr.unit ? ` ${kr.unit}` : ''
  if (kr.target_type === 'percentage') {
    return `${Math.round(kr.current_value)}%`
  }
  return `${kr.current_value}${unit}`
}

export function formatTarget(kr: KeyResult): string {
  if (kr.target_type === 'boolean') return 'Complete'
  const unit = kr.unit ? ` ${kr.unit}` : ''
  if (kr.target_type === 'percentage') return `${kr.target_value}%`
  return `${kr.target_value}${unit}`
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'on_track':  return 'text-green-700 bg-green-50 ring-green-600/20'
    case 'at_risk':   return 'text-yellow-700 bg-yellow-50 ring-yellow-600/20'
    case 'behind':    return 'text-red-700 bg-red-50 ring-red-600/20'
    case 'completed': return 'text-indigo-700 bg-indigo-50 ring-indigo-600/20'
    default:          return 'text-gray-700 bg-gray-50 ring-gray-600/20'
  }
}

export function getStatusLabel(status: string): string {
  switch (status) {
    case 'on_track':  return 'On Track'
    case 'at_risk':   return 'At Risk'
    case 'behind':    return 'Behind'
    case 'completed': return 'Completed'
    default:          return status
  }
}

export function getProgressColor(progress: number): string {
  if (progress >= 70) return '#16a34a'  // green-600
  if (progress >= 40) return '#ca8a04'  // yellow-600
  return '#dc2626'                       // red-600
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function getCurrentQuarter(): { year: number; quarter: number } {
  const now = new Date()
  return {
    year: now.getFullYear(),
    quarter: Math.ceil((now.getMonth() + 1) / 3),
  }
}
