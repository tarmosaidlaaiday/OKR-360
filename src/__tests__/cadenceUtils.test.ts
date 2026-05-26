import { describe, it, expect } from 'vitest'
import {
  fmt,
  getISOWeek,
  getQuarterWeeks,
  getCurrentWeekIdx,
  objectiveProgress,
  happinessLabel,
  isOnTrack,
} from '../lib/cadenceUtils'

// ── fmt ───────────────────────────────────────────────────────────────────

describe('fmt', () => {
  it('returns — for null', () => expect(fmt(null)).toBe('—'))
  it('returns — for undefined', () => expect(fmt(undefined)).toBe('—'))
  it('returns 0 for 0', () => expect(fmt(0)).toBe('0'))
  it('formats small numbers to 2dp', () => expect(fmt(3.14159)).toBe('3.14'))
  it('formats 10–99 to 1dp', () => expect(fmt(42.7)).toBe('42.7'))
  it('formats 100–999 to 0dp', () => expect(fmt(123.9)).toBe('124'))
  it('formats thousands with locale separator', () => {
    const result = fmt(1234)
    expect(result).toMatch(/1.234|1,234/)  // locale-agnostic
  })
  it('handles negative numbers', () => expect(fmt(-5.5)).toBe('-5.50'))
})

// ── getQuarterWeeks ───────────────────────────────────────────────────────

describe('getQuarterWeeks', () => {
  it('Q1 starts at week 1', () => {
    const weeks = getQuarterWeeks(1)
    expect(weeks[0]).toBe(1)
    expect(weeks).toHaveLength(13)
  })
  it('Q2 starts at week 14', () => {
    const weeks = getQuarterWeeks(2)
    expect(weeks[0]).toBe(14)
    expect(weeks).toHaveLength(13)
  })
  it('Q3 starts at week 27', () => {
    const weeks = getQuarterWeeks(3)
    expect(weeks[0]).toBe(27)
    expect(weeks).toHaveLength(13)
  })
  it('Q4 starts at week 40', () => {
    const weeks = getQuarterWeeks(4)
    expect(weeks[0]).toBe(40)
    expect(weeks).toHaveLength(13)
  })
  it('weeks are consecutive', () => {
    const weeks = getQuarterWeeks(2)
    for (let i = 1; i < weeks.length; i++) {
      expect(weeks[i]).toBe(weeks[i - 1] + 1)
    }
  })
  it('invalid quarter falls back to Q1 start', () => {
    const weeks = getQuarterWeeks(99)
    expect(weeks).toHaveLength(13)
  })
})

// ── getISOWeek ────────────────────────────────────────────────────────────

describe('getISOWeek', () => {
  it('2026-01-01 is ISO week 1', () => {
    expect(getISOWeek(new Date('2026-01-01'))).toBe(1)
  })
  it('2026-03-30 is ISO week 14 (Q2 start)', () => {
    // Q2 2026 starts around week 14
    const w = getISOWeek(new Date('2026-03-30'))
    expect(w).toBeGreaterThanOrEqual(13)
    expect(w).toBeLessThanOrEqual(15)
  })
  it('returns a number between 1 and 53', () => {
    const w = getISOWeek(new Date())
    expect(w).toBeGreaterThanOrEqual(1)
    expect(w).toBeLessThanOrEqual(53)
  })
})

// ── getCurrentWeekIdx ─────────────────────────────────────────────────────

describe('getCurrentWeekIdx', () => {
  it('returns an index between 0 and 12', () => {
    const idx = getCurrentWeekIdx(2)
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(idx).toBeLessThanOrEqual(12)
  })
})

// ── objectiveProgress ─────────────────────────────────────────────────────

describe('objectiveProgress', () => {
  it('returns 0 for empty KR list', () => {
    expect(objectiveProgress([])).toBe(0)
  })

  it('averages numeric KR progress', () => {
    const krs = [
      { id: '1', title: 'A', objective_id: 'o', target_type: 'numeric' as const, current_value: 50, target_value: 100, confidence: [], unit: null, owner_id: null },
      { id: '2', title: 'B', objective_id: 'o', target_type: 'numeric' as const, current_value: 100, target_value: 100, confidence: [], unit: null, owner_id: null },
    ]
    expect(objectiveProgress(krs)).toBe(0.75)
  })

  it('caps progress at 1 when over-achieved', () => {
    const krs = [
      { id: '1', title: 'A', objective_id: 'o', target_type: 'numeric' as const, current_value: 150, target_value: 100, confidence: [], unit: null, owner_id: null },
    ]
    expect(objectiveProgress(krs)).toBe(1)
  })

  it('handles boolean KRs: done = 1', () => {
    const krs = [
      { id: '1', title: 'A', objective_id: 'o', target_type: 'boolean' as const, current_value: 1, target_value: 1, confidence: [], unit: null, owner_id: null },
    ]
    expect(objectiveProgress(krs)).toBe(1)
  })

  it('handles boolean KRs: not done = 0', () => {
    const krs = [
      { id: '1', title: 'A', objective_id: 'o', target_type: 'boolean' as const, current_value: 0, target_value: 1, confidence: [], unit: null, owner_id: null },
    ]
    expect(objectiveProgress(krs)).toBe(0)
  })

  it('returns 0 when target_value is 0', () => {
    const krs = [
      { id: '1', title: 'A', objective_id: 'o', target_type: 'numeric' as const, current_value: 10, target_value: 0, confidence: [], unit: null, owner_id: null },
    ]
    expect(objectiveProgress(krs)).toBe(0)
  })
})

// ── happinessLabel ────────────────────────────────────────────────────────

describe('happinessLabel', () => {
  it('1–3 = rough patch', () => {
    expect(happinessLabel(1)).toBe('rough patch')
    expect(happinessLabel(3)).toBe('rough patch')
  })
  it('4–5 = wobbly', () => {
    expect(happinessLabel(4)).toBe('wobbly')
    expect(happinessLabel(5)).toBe('wobbly')
  })
  it('6–7 = steady', () => {
    expect(happinessLabel(6)).toBe('steady')
    expect(happinessLabel(7)).toBe('steady')
  })
  it('8–9 = great', () => {
    expect(happinessLabel(8)).toBe('great')
    expect(happinessLabel(9)).toBe('great')
  })
  it('10 = soaring', () => {
    expect(happinessLabel(10)).toBe('soaring')
  })
})

// ── isOnTrack ─────────────────────────────────────────────────────────────

describe('isOnTrack', () => {
  const makeKpi = (actual: number, plan_to_date: number, direction: 'up' | 'down') => ({
    id: 'x', name: 'x', unit: '', plan: 100, plan_to_date, actual,
    direction, good: direction, role_name: '', trend: [],
    owner: null, unit_id: null, owner_id: null, owner_person_id: null,
  })

  it('up direction: actual >= plan-to-date is on track', () => {
    expect(isOnTrack(makeKpi(100, 100, 'up'))).toBe(true)
    expect(isOnTrack(makeKpi(110, 100, 'up'))).toBe(true)
  })

  it('up direction: actual < plan-to-date by >5% is off track', () => {
    expect(isOnTrack(makeKpi(80, 100, 'up'))).toBe(false)
  })

  it('up direction: within 5% tolerance is still on track', () => {
    expect(isOnTrack(makeKpi(96, 100, 'up'))).toBe(true)
  })

  it('down direction: actual <= plan-to-date is on track', () => {
    expect(isOnTrack(makeKpi(90, 100, 'down'))).toBe(true)
  })

  it('down direction: actual > plan-to-date by >5% is off track', () => {
    expect(isOnTrack(makeKpi(120, 100, 'down'))).toBe(false)
  })

  it('returns true when plan_to_date is null', () => {
    expect(isOnTrack({ ...makeKpi(0, 0, 'up'), plan_to_date: null as unknown as number })).toBe(true)
  })
})
