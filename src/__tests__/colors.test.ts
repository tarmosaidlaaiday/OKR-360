import { describe, it, expect } from 'vitest'
import { confidenceColor, confidenceTextColor, avatarColor } from '../lib/colors'

describe('confidenceColor', () => {
  it('returns an oklch string', () => {
    const c = confidenceColor(5)
    expect(c).toMatch(/^oklch\(/)
  })
  it('clamps below 1 to 1', () => {
    expect(confidenceColor(0)).toBe(confidenceColor(1))
  })
  it('clamps above 10 to 10', () => {
    expect(confidenceColor(11)).toBe(confidenceColor(10))
  })
  it('produces different colors for different values', () => {
    expect(confidenceColor(1)).not.toBe(confidenceColor(10))
  })
})

describe('confidenceTextColor', () => {
  it('returns an oklch string', () => {
    expect(confidenceTextColor(5)).toMatch(/^oklch\(/)
  })
  it('produces different colors for low vs high confidence', () => {
    expect(confidenceTextColor(1)).not.toBe(confidenceTextColor(10))
  })
})

describe('avatarColor', () => {
  it('returns a hex color string', () => {
    expect(avatarColor('test-id')).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })
  it('is deterministic — same id = same color', () => {
    expect(avatarColor('abc')).toBe(avatarColor('abc'))
  })
  it('produces different colors for different ids (usually)', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const colors = ids.map(avatarColor)
    const unique = new Set(colors)
    expect(unique.size).toBeGreaterThan(1)
  })
})
