import { describe, expect, it } from 'vitest'
import { formatRemainingTime } from './format'

describe('formatRemainingTime', () => {
  it('formats minutes and zero-padded seconds', () => {
    expect(formatRemainingTime(120)).toBe('2:00')
    expect(formatRemainingTime(65)).toBe('1:05')
    expect(formatRemainingTime(5)).toBe('0:05')
    expect(formatRemainingTime(180)).toBe('3:00')
    expect(formatRemainingTime(59)).toBe('0:59')
  })

  it('clamps at 0:00 and floors fractions', () => {
    expect(formatRemainingTime(0)).toBe('0:00')
    expect(formatRemainingTime(-3)).toBe('0:00')
    expect(formatRemainingTime(61.9)).toBe('1:01')
  })
})
