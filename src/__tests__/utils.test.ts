import { describe, it, expect } from 'vitest'
import {
  computeObjectiveProgress,
  formatValue,
  formatTarget,
  getStatusColor,
  getStatusLabel,
  getCurrentQuarter,
} from '../lib/utils'

describe('computeObjectiveProgress', () => {
  it('returns 0 for empty array', () => {
    expect(computeObjectiveProgress([])).toBe(0)
  })

  it('returns 100 when all KRs complete', () => {
    const krs = [
      { id: '1', title: 'A', objective_id: 'o', target_type: 'numeric' as const, current_value: 100, target_value: 100, unit: null, created_at: '', updated_at: '' },
    ]
    expect(computeObjectiveProgress(krs)).toBe(100)
  })

  it('caps at 100 when overachieved', () => {
    const krs = [
      { id: '1', title: 'A', objective_id: 'o', target_type: 'numeric' as const, current_value: 150, target_value: 100, unit: null, created_at: '', updated_at: '' },
    ]
    expect(computeObjectiveProgress(krs)).toBe(100)
  })

  it('boolean done = 100', () => {
    const krs = [
      { id: '1', title: 'A', objective_id: 'o', target_type: 'boolean' as const, current_value: 1, target_value: 1, unit: null, created_at: '', updated_at: '' },
    ]
    expect(computeObjectiveProgress(krs)).toBe(100)
  })

  it('boolean not done = 0', () => {
    const krs = [
      { id: '1', title: 'A', objective_id: 'o', target_type: 'boolean' as const, current_value: 0, target_value: 1, unit: null, created_at: '', updated_at: '' },
    ]
    expect(computeObjectiveProgress(krs)).toBe(0)
  })

  it('averages multiple KRs', () => {
    const krs = [
      { id: '1', title: 'A', objective_id: 'o', target_type: 'numeric' as const, current_value: 0, target_value: 100, unit: null, created_at: '', updated_at: '' },
      { id: '2', title: 'B', objective_id: 'o', target_type: 'numeric' as const, current_value: 100, target_value: 100, unit: null, created_at: '', updated_at: '' },
    ]
    expect(computeObjectiveProgress(krs)).toBe(50)
  })
})

describe('formatValue', () => {
  it('numeric with unit', () => {
    const kr = { id: '1', title: 'A', objective_id: 'o', target_type: 'numeric' as const, current_value: 42, target_value: 100, unit: '$', created_at: '', updated_at: '' }
    expect(formatValue(kr)).toBe('42 $')
  })
  it('percentage', () => {
    const kr = { id: '1', title: 'A', objective_id: 'o', target_type: 'percentage' as const, current_value: 75, target_value: 100, unit: null, created_at: '', updated_at: '' }
    expect(formatValue(kr)).toBe('75%')
  })
  it('boolean done', () => {
    const kr = { id: '1', title: 'A', objective_id: 'o', target_type: 'boolean' as const, current_value: 1, target_value: 1, unit: null, created_at: '', updated_at: '' }
    expect(formatValue(kr)).toBe('Done')
  })
  it('boolean not done', () => {
    const kr = { id: '1', title: 'A', objective_id: 'o', target_type: 'boolean' as const, current_value: 0, target_value: 1, unit: null, created_at: '', updated_at: '' }
    expect(formatValue(kr)).toBe('Not done')
  })
})

describe('formatTarget', () => {
  it('boolean = Complete', () => {
    const kr = { id: '1', title: 'A', objective_id: 'o', target_type: 'boolean' as const, current_value: 0, target_value: 1, unit: null, created_at: '', updated_at: '' }
    expect(formatTarget(kr)).toBe('Complete')
  })
  it('percentage', () => {
    const kr = { id: '1', title: 'A', objective_id: 'o', target_type: 'percentage' as const, current_value: 0, target_value: 80, unit: null, created_at: '', updated_at: '' }
    expect(formatTarget(kr)).toBe('80%')
  })
})

describe('getStatusLabel', () => {
  it('maps known statuses', () => {
    expect(getStatusLabel('on_track')).toBe('On Track')
    expect(getStatusLabel('at_risk')).toBe('At Risk')
    expect(getStatusLabel('behind')).toBe('Behind')
    expect(getStatusLabel('completed')).toBe('Completed')
  })
  it('returns unknown status as-is', () => {
    expect(getStatusLabel('mystery')).toBe('mystery')
  })
})

describe('getStatusColor', () => {
  it('returns a class string for known statuses', () => {
    expect(getStatusColor('on_track')).toContain('green')
    expect(getStatusColor('at_risk')).toContain('yellow')
    expect(getStatusColor('behind')).toContain('red')
    expect(getStatusColor('completed')).toContain('indigo')
  })
  it('returns gray for unknown status', () => {
    expect(getStatusColor('unknown')).toContain('gray')
  })
})

describe('getCurrentQuarter', () => {
  it('returns a year and quarter', () => {
    const { year, quarter } = getCurrentQuarter()
    expect(year).toBeGreaterThan(2020)
    expect(quarter).toBeGreaterThanOrEqual(1)
    expect(quarter).toBeLessThanOrEqual(4)
  })
  it('quarter matches current month', () => {
    const { quarter } = getCurrentQuarter()
    const month = new Date().getMonth() + 1
    const expected = Math.ceil(month / 3)
    expect(quarter).toBe(expected)
  })
})
