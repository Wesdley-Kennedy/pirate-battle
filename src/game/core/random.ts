/**
 * Injectable randomness for the simulation. Systems never call
 * Math.random() directly — they use the session's RandomSource, so a fixed
 * seed reproduces the exact same sequence in tests.
 */
export interface RandomSource {
  /** Uniform float in [0, 1). */
  next(): number
}

/**
 * mulberry32 — small, well-known public-domain PRNG (Tommy Ettinger).
 * 32-bit state, good statistical quality for gameplay purposes.
 */
export function createSeededRandom(seed: number): RandomSource {
  let state = seed >>> 0
  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0
      let t = state
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

/**
 * Entropy entry point for production sessions. The resulting seed is stored
 * on the session, so any match can be replayed deterministically.
 */
export function createRandomSeed(): number {
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return buffer[0] ?? 0
}
