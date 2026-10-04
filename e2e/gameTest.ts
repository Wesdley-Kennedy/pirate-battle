import { expect, type Page } from '@playwright/test'

/** Mirror of the dev-only window.__gameTest read-only snapshot. */
export interface TestSnapshot {
  lifecycle: string
  activeElapsedSeconds: number
  arena: { width: number; height: number }
  player: {
    x: number
    y: number
    rotation: number
    collisionRadius: number
    health: number
    maxHealth: number
    alive: boolean
  }
  islands: { id: string; x: number; y: number; radius: number }[]
  score: number
  endReason: string | null
  remainingSeconds: number
  projectiles: {
    id: number
    owner: string
    x: number
    y: number
    directionX: number
    directionY: number
    lifetimeRemaining: number
  }[]
  weaponCooldowns: { front: number; left: number; right: number }
  totalShotsFired: number
  totalIslandImpacts: number
  totalChaserImpacts: number
  totalEnemyProjectileHits: number
  totalAutomaticSpawns: number
  totalSpawnFailures: number
  spawnCooldownSeconds: number
  seed: number
  enemies: {
    id: number
    type: string
    x: number
    y: number
    rotation: number
    health: number
    maxHealth: number
  }[]
}

declare global {
  interface Window {
    __gameTest?: {
      snapshot(): TestSnapshot
      pause(): void
      resume(): void
      spawnEnemy(type: 'chaser' | 'shooter', x: number, y: number, rotation?: number): number
      removeEnemy(id: number): boolean
      setEnemyDrive(id: number, targetHeading: number | null, forward: boolean): void
      advanceTime(seconds: number): void
      restart(seed?: number): void
    }
  }
}

export const SPAWN = { x: 240, y: 700 }

export function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  return errors
}

export async function snapshot(page: Page): Promise<TestSnapshot> {
  const result = await page.evaluate(() => window.__gameTest?.snapshot())
  if (!result) throw new Error('Game test API not available')
  return result
}

/** Poll-safe: returns undefined (retryable) while the test API is not installed yet. */
export function lifecycleOf(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__gameTest?.snapshot().lifecycle)
}

/** From the Main Menu (already rendered) into a running match. */
export async function startGameFromMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.locator('.game-stage canvas')).toHaveCount(1, { timeout: 15000 })
  // Generous timeout: under full-suite parallel load, first paint + asset
  // load + session start can take a while.
  await expect.poll(() => lifecycleOf(page), { timeout: 15000 }).toBe('running')
}

export async function gotoRunningGame(page: Page): Promise<void> {
  await page.goto('/')
  await startGameFromMenu(page)
}

/**
 * Abandons the current match back to the Main Menu (pause → Main Menu),
 * verifying the full teardown: no canvas left behind.
 */
export async function exitToMenu(page: Page): Promise<void> {
  const state = await lifecycleOf(page)
  if (state === 'running') await page.evaluate(() => window.__gameTest?.pause())
  await page.getByRole('button', { name: 'Main Menu' }).click()
  await expect(page.locator('.game-stage canvas')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
}

/** Full unmount/remount cycle through the real screen flow. */
export async function remountGame(page: Page): Promise<void> {
  await exitToMenu(page)
  await startGameFromMenu(page)
}

/**
 * Press-and-hold tap. keyboard.press() releases within a few ms; under CI
 * load no simulation step may run inside that window, so the intent would
 * never be observed. Holding ~120ms guarantees at least one fixed step
 * sees the key, like a real key tap does.
 */
export async function tapKey(page: Page, key: string, holdMs = 120): Promise<void> {
  await page.keyboard.down(key)
  await page.waitForTimeout(holdMs)
  await page.keyboard.up(key)
}

export function wrapAngle(radians: number): number {
  const twoPi = Math.PI * 2
  return ((((radians + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI
}

/**
 * Steers toward the target heading with real key presses in a closed loop.
 * Press durations derive from the remaining error at π rad/s; under CI
 * load key-up latency adds jitter, so callers pass the tolerance they
 * actually need instead of expecting precision.
 */
export async function steerTo(page: Page, target: number, tolerance: number): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    const rotation = (await snapshot(page)).player.rotation
    const error = wrapAngle(target - rotation)
    if (Math.abs(error) < tolerance) return
    const key = error > 0 ? 'KeyD' : 'KeyA'
    // Undershoot on purpose (70%): key-up latency inflates every press,
    // and overshooting flips the error sign and oscillates forever.
    const pressMs = Math.min(500, Math.max(30, (Math.abs(error) / Math.PI) * 850 * 0.7))
    await page.keyboard.down(key)
    await page.waitForTimeout(pressMs)
    await page.keyboard.up(key)
  }
  expect(Math.abs(wrapAngle(target - (await snapshot(page)).player.rotation))).toBeLessThan(
    tolerance,
  )
}

/**
 * Closed-loop homing to a point: re-aims every iteration and advances
 * with short W taps, so steering jitter self-corrects as the ship closes
 * in. Stops once the measured distance reaches `stopDistance`.
 * 0.25 rad aim gate + 70% undershoot keep corrections from oscillating
 * under key-latency jitter.
 */
export async function driveToPoint(
  page: Page,
  targetX: number,
  targetY: number,
  stopDistance: number,
): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
    const snap = await snapshot(page)
    const dx = targetX - snap.player.x
    const dy = targetY - snap.player.y
    if (Math.hypot(dx, dy) <= stopDistance) return
    const error = wrapAngle(Math.atan2(dx, -dy) - snap.player.rotation)
    if (Math.abs(error) > 0.25) {
      const key = error > 0 ? 'KeyD' : 'KeyA'
      await page.keyboard.down(key)
      await page.waitForTimeout(Math.min(400, Math.max(20, (Math.abs(error) / Math.PI) * 850 * 0.7)))
      await page.keyboard.up(key)
    } else {
      await page.keyboard.down('KeyW')
      await page.waitForTimeout(250)
      await page.keyboard.up('KeyW')
    }
  }
  throw new Error(`driveToPoint(${targetX}, ${targetY}) did not reach distance ${stopDistance}`)
}

export async function driveToward(
  page: Page,
  islandId: string,
  stopDistance: number,
): Promise<void> {
  const snap = await snapshot(page)
  const island = snap.islands.find((entry) => entry.id === islandId)
  if (!island) throw new Error(`island not found: ${islandId}`)
  await driveToPoint(page, island.x, island.y, stopDistance)
}

/**
 * Background groundskeeper for long player-movement journeys: removes
 * every enemy (via the real removeEnemy API) shortly after it spawns, so
 * the PHASE 11 periodic spawner cannot kill the idle-ish player mid-test.
 * Call the returned function to stop it before the test ends.
 */
export function startEnemySweeper(page: Page): () => Promise<void> {
  let active = true
  const loop = (async () => {
    while (active) {
      try {
        await page.evaluate(() => {
          const api = window.__gameTest
          if (!api) return
          for (const enemy of api.snapshot().enemies) api.removeEnemy(enemy.id)
        })
      } catch {
        // page navigating/closing: just stop sweeping
        break
      }
      await page.waitForTimeout(400).catch(() => {})
    }
  })()
  return async () => {
    active = false
    await loop
  }
}

export function distanceTo(snap: TestSnapshot, islandId: string): number {
  const island = snap.islands.find((entry) => entry.id === islandId)
  if (!island) throw new Error(`island not found: ${islandId}`)
  return Math.hypot(snap.player.x - island.x, snap.player.y - island.y)
}
