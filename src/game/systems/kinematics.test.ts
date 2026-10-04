import { describe, expect, it } from 'vitest'
import { wrapAngle } from '../core/angles'
import { moveForward, rotateTowardHeading } from './kinematics'

const STEP = 1 / 60

describe('wrapAngle', () => {
  it('wraps into [-PI, PI)', () => {
    expect(wrapAngle(0)).toBe(0)
    expect(wrapAngle(Math.PI * 2)).toBeCloseTo(0, 12)
    expect(wrapAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI * 0.5, 12)
    expect(wrapAngle(-Math.PI * 2.5)).toBeCloseTo(-Math.PI * 0.5, 12)
  })
})

describe('moveForward', () => {
  it('travels speed × time along the heading', () => {
    const position = { x: 100, y: 100 }
    for (let i = 0; i < 60; i += 1) moveForward(position, Math.PI / 2, 120, STEP)
    expect(position.x).toBeCloseTo(220, 6) // facing +x
    expect(position.y).toBeCloseTo(100, 6)
  })
})

describe('rotateTowardHeading', () => {
  const SPEED = Math.PI // rad/s

  it('takes the short way across the ±PI seam (179° → -179°)', () => {
    const from = (179 / 180) * Math.PI
    const to = (-179 / 180) * Math.PI
    // The short arc is only +2° — BELOW one max step — so a correct
    // implementation crosses the seam and snaps onto the target at once,
    // instead of sweeping ~358° back through zero.
    const next = rotateTowardHeading(from, to, SPEED, STEP)
    const moved = Math.abs(wrapAngle(next - from))
    expect(moved).toBeLessThanOrEqual(SPEED * STEP + 1e-9)
    expect(moved).toBeCloseTo((2 / 180) * Math.PI, 9)
    expect(Math.abs(wrapAngle(to - next))).toBeLessThan(1e-9)
  })

  it('takes the short way across the seam in the other direction (-179° → 179°)', () => {
    const from = (-179 / 180) * Math.PI
    const to = (179 / 180) * Math.PI
    const next = rotateTowardHeading(from, to, SPEED, STEP)
    expect(Math.abs(wrapAngle(to - next))).toBeLessThan(Math.abs(wrapAngle(to - from)))
  })

  it('never overshoots: snaps exactly onto a close target', () => {
    const next = rotateTowardHeading(0.01, 0.02, SPEED, STEP) // maxStep ≈ 0.052 > gap
    expect(next).toBe(0.02) // bit-exact thanks to the wrapAngle fast path
  })

  it('property: for many angle pairs, convergence is monotonic, bounded and normalized', () => {
    for (let i = 0; i < 24; i += 1) {
      for (let j = 0; j < 24; j += 1) {
        const source = wrapAngle((i / 24) * Math.PI * 2)
        const target = wrapAngle((j / 24) * Math.PI * 2 + 0.013) // avoid exact ties
        let current = source
        let remaining = Math.abs(wrapAngle(target - current))
        const maxIterations = Math.ceil(Math.PI / (SPEED * STEP)) + 2
        for (let step = 0; step < maxIterations; step += 1) {
          const next = rotateTowardHeading(current, target, SPEED, STEP)
          const stepSize = Math.abs(wrapAngle(next - current))
          const nextRemaining = Math.abs(wrapAngle(target - next))
          expect(stepSize).toBeLessThanOrEqual(SPEED * STEP + 1e-9) // bounded
          expect(nextRemaining).toBeLessThanOrEqual(remaining + 1e-9) // monotonic
          expect(next).toBeGreaterThanOrEqual(-Math.PI)
          expect(next).toBeLessThan(Math.PI)
          current = next
          remaining = nextRemaining
          if (remaining < 1e-9) break
        }
        expect(remaining).toBeLessThan(1e-9) // always converges onto the target
      }
    }
  })
})
