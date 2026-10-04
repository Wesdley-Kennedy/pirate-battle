import { describe, expect, it } from 'vitest'
import { createRandomSeed, createSeededRandom } from './random'

function sequence(seed: number, length: number): number[] {
  const random = createSeededRandom(seed)
  return Array.from({ length }, () => random.next())
}

describe('createSeededRandom (mulberry32)', () => {
  it('reproduces the exact same sequence for the same seed', () => {
    expect(sequence(12345, 50)).toEqual(sequence(12345, 50))
  })

  it('produces different sequences for different seeds', () => {
    expect(sequence(1, 20)).not.toEqual(sequence(2, 20))
  })

  it('stays within [0, 1)', () => {
    const random = createSeededRandom(987654321)
    for (let i = 0; i < 1000; i += 1) {
      const value = random.next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('createRandomSeed returns an unsigned 32-bit integer', () => {
    const seed = createRandomSeed()
    expect(Number.isInteger(seed)).toBe(true)
    expect(seed).toBeGreaterThanOrEqual(0)
    expect(seed).toBeLessThanOrEqual(0xffffffff)
  })
})
