import { expect, test } from '@playwright/test'
import { collectErrors, gotoRunningGame, remountGame, snapshot } from './gameTest'

const INTERVAL = 5 // DEFAULT_GAME_CONFIG.match.enemySpawnIntervalSeconds

test('arena starts empty and the first enemy only appears after one full interval', async ({
  page,
}) => {
  test.slow()
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  const initial = await snapshot(page)
  expect(initial.enemies).toHaveLength(0)
  expect(initial.totalAutomaticSpawns).toBe(0)
  expect(initial.spawnCooldownSeconds).toBeGreaterThan(0)
  expect(initial.spawnCooldownSeconds).toBeLessThanOrEqual(INTERVAL)

  // Sampled invariant: nothing spawns while active time < the interval.
  for (;;) {
    const snap = await snapshot(page)
    if (snap.activeElapsedSeconds >= INTERVAL - 0.8) break
    expect(snap.totalAutomaticSpawns).toBe(0)
    await page.waitForTimeout(200)
  }

  await expect
    .poll(async () => (await snapshot(page)).totalAutomaticSpawns, { timeout: 15000 })
    .toBeGreaterThanOrEqual(1)
  const after = await snapshot(page)
  const newborn = after.enemies[after.enemies.length - 1]!
  expect(newborn.health).toBe(newborn.maxHealth)
  // Born ≥ 380 px away; generous slack for sampling latency while it moves.
  expect(Math.hypot(newborn.x - after.player.x, newborn.y - after.player.y)).toBeGreaterThan(290)
  expect(errors).toEqual([])
})

test('spawning continues periodically, both types appear, and newborns start their AI', async ({
  page,
}) => {
  test.slow()
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  // Track enemy types and movement across samples until both kinds showed up.
  const seenTypes = new Set<string>()
  const firstSeenAt = new Map<number, { x: number; y: number }>()
  let sawMovement = false
  const deadline = Date.now() + 30000
  for (;;) {
    const snap = await snapshot(page)
    for (const enemy of snap.enemies) {
      seenTypes.add(enemy.type)
      const first = firstSeenAt.get(enemy.id)
      if (!first) firstSeenAt.set(enemy.id, { x: enemy.x, y: enemy.y })
      else if (Math.hypot(enemy.x - first.x, enemy.y - first.y) > 10) sawMovement = true
    }
    if (snap.totalAutomaticSpawns >= 2 && seenTypes.size === 2 && sawMovement) break
    if (Date.now() > deadline) break
    await page.waitForTimeout(250)
  }
  const finalSnap = await snapshot(page)
  expect(finalSnap.totalAutomaticSpawns).toBeGreaterThanOrEqual(2)
  expect(seenTypes).toEqual(new Set(['chaser', 'shooter'])) // both-types guarantee
  expect(sawMovement).toBe(true) // AI engaged on its own
  expect(errors).toEqual([])
})

test('pause freezes the spawn timer; resume continues it', async ({ page }) => {
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  await page.waitForTimeout(800)
  await page.evaluate(() => window.__gameTest?.pause())
  const frozenA = await snapshot(page)
  await page.waitForTimeout(700)
  const frozenB = await snapshot(page)
  expect(frozenB.spawnCooldownSeconds).toBe(frozenA.spawnCooldownSeconds)
  expect(frozenB.totalAutomaticSpawns).toBe(frozenA.totalAutomaticSpawns)

  await page.evaluate(() => window.__gameTest?.resume())
  await expect
    .poll(async () => (await snapshot(page)).spawnCooldownSeconds)
    .toBeLessThan(frozenA.spawnCooldownSeconds)
  expect(errors).toEqual([])
})

test('remount resets the spawner completely', async ({ page }) => {
  test.slow()
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  await expect
    .poll(async () => (await snapshot(page)).totalAutomaticSpawns, { timeout: 30000 })
    .toBeGreaterThanOrEqual(1)

  await remountGame(page)

  const fresh = await snapshot(page)
  expect(fresh.enemies).toHaveLength(0)
  expect(fresh.totalAutomaticSpawns).toBe(0)
  expect(fresh.totalSpawnFailures).toBe(0)
  expect(fresh.spawnCooldownSeconds).toBeGreaterThan(INTERVAL - 0.5)
  expect(errors).toEqual([])
})
