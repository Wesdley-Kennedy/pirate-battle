/**
 * Injectable time source for the simulation. The core never reads
 * Date.now()/performance.now() directly — it always goes through a Clock,
 * so tests can drive time manually and deterministically.
 */
export interface Clock {
  /** Monotonic current time in seconds. */
  now(): number
}

/** Production clock backed by performance.now() (monotonic, sub-ms). */
export function createRealClock(): Clock {
  return {
    now: () => performance.now() / 1000,
  }
}

/** Test clock advanced explicitly; also used by future test instrumentation. */
export class ManualClock implements Clock {
  private current: number

  constructor(startAtSeconds = 0) {
    this.current = startAtSeconds
  }

  now(): number {
    return this.current
  }

  advance(seconds: number): void {
    this.current += seconds
  }
}
