import { expect, test, type Page } from '@playwright/test'
import { collectErrors, driveToPoint, gotoRunningGame, remountGame, snapshot } from './gameTest'

function spawn(page: Page, type: 'chaser' | 'shooter', x: number, y: number, rotation = 0) {
  return page.evaluate(
    (args) => window.__gameTest!.spawnEnemy(args.type, args.x, args.y, args.rotation),
    { type, x, y, rotation },
  )
}

async function shooterPlayerDistance(page: Page, id: number): Promise<number> {
  const snap = await snapshot(page)
  const enemy = snap.enemies.find((entry) => entry.id === id)
  if (!enemy) throw new Error(`shooter ${id} not found`)
  return Math.hypot(enemy.x - snap.player.x, enemy.y - snap.player.y)
}

test('shooter approaches alone, never fires out of range, holds in range and lands hits on its own cadence', async ({
  page,
}) => {
  test.slow()
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  // Straight above the player (240, 700), pre-aligned facing down.
  const id = await spawn(page, 'shooter', 240, 150, Math.PI)

  // Sampled invariant while approaching: no shots beyond the range.
  const deadline = Date.now() + 20000
  for (;;) {
    const snap = await snapshot(page)
    const enemy = snap.enemies.find((entry) => entry.id === id)!
    const distance = Math.hypot(enemy.x - snap.player.x, enemy.y - snap.player.y)
    if (distance <= 330) break
    if (distance > 340) {
      expect(snap.projectiles).toHaveLength(0)
      expect(snap.totalEnemyProjectileHits).toBe(0)
    }
    if (Date.now() > deadline) throw new Error('shooter never reached the attack range')
    await page.waitForTimeout(120)
  }

  // Holds position inside the range (stationary player → no jitter).
  await page.waitForTimeout(500)
  const restingA = await shooterPlayerDistance(page, id)
  await page.waitForTimeout(400)
  const restingB = await shooterPlayerDistance(page, id)
  expect(Math.abs(restingA - restingB)).toBeLessThan(6)
  expect(restingB).toBeGreaterThan(290)
  expect(restingB).toBeLessThanOrEqual(335)

  // Fires on its own and hits the player.
  await expect
    .poll(async () => (await snapshot(page)).totalEnemyProjectileHits, { timeout: 10000 })
    .toBeGreaterThanOrEqual(1)
  // Cadence is cooldown-gated: within the next 0.8s of wall time (≤ 0.8s
  // of simulation) no second hit can land (cooldown 1.6s).
  const hits = (await snapshot(page)).totalEnemyProjectileHits
  await page.waitForTimeout(800)
  expect((await snapshot(page)).totalEnemyProjectileHits).toBeLessThanOrEqual(hits + 1)
  expect(errors).toEqual([])
})

test('an island between shooter and player eats the shots: no player hits', async ({ page }) => {
  test.slow()
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  // Park the player south of island-south, then spawn a shooter north of
  // it, in range and aligned: its ball must die on the island coast.
  // The whole scenario runs inside RAF-sandwich micro-resumes (~0.1 s of
  // simulation total), so the PHASE 11 periodic spawner never interferes
  // and no other enemy can touch the player.
  await driveToPoint(page, 800, 790, 45)
  await page.evaluate(() => window.__gameTest?.pause())
  const before = await snapshot(page)
  await spawn(page, 'shooter', 800, 480, Math.PI)

  for (let i = 0; i < 12; i += 1) {
    await page.evaluate(async () => {
      window.__gameTest!.resume()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      window.__gameTest!.pause()
    })
    const current = await snapshot(page)
    if (current.totalIslandImpacts > before.totalIslandImpacts) break
  }
  const after = await snapshot(page)
  expect(after.totalIslandImpacts).toBeGreaterThan(before.totalIslandImpacts)
  expect(after.totalEnemyProjectileHits).toBe(before.totalEnemyProjectileHits) // island blocked it
  await page.evaluate(() => window.__gameTest?.resume())
  expect(errors).toEqual([])
})

test('two shooters act independently: one fires in range while the other still approaches', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  await page.evaluate(() => window.__gameTest?.pause())
  // S1: 272 px from the player, pre-aligned → fires as soon as we resume.
  const s1 = await spawn(page, 'shooter', 400, 480, -2.513)
  // S2: far away → must approach first.
  const s2 = await spawn(page, 'shooter', 1300, 450, 0)
  await page.evaluate(() => window.__gameTest?.resume())

  // S1 produces a ball/hit while S2 is still travelling.
  await expect
    .poll(
      async () => {
        const snap = await snapshot(page)
        return snap.projectiles.length + snap.totalEnemyProjectileHits
      },
      { timeout: 5000 },
    )
    .toBeGreaterThan(0)
  // S2 keeps approaching while S1 fires: poll its displacement growing.
  await expect
    .poll(
      async () => {
        const current = (await snapshot(page)).enemies.find((entry) => entry.id === s2)
        return current ? Math.hypot(current.x - 1300, current.y - 450) : 999
      },
      { timeout: 5000 },
    )
    .toBeGreaterThan(15)
  const stayer = (await snapshot(page)).enemies.find((entry) => entry.id === s1)!
  expect(Math.hypot(stayer.x - 400, stayer.y - 480)).toBeLessThan(10) // holding + firing
  expect(errors).toEqual([])
})

test('pause freezes shooter, cooldown and balls; resume continues without a burst', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  await page.evaluate(() => window.__gameTest?.pause())
  const id = await spawn(page, 'shooter', 400, 480, -2.513) // in range, aligned
  // Resume exactly 2 frames inside the page: the first shot comes out,
  // then everything freezes again (same latency-proof pattern as weapons).
  await page.evaluate(async () => {
    window.__gameTest!.resume()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    window.__gameTest!.pause()
  })

  const frozen = await snapshot(page)
  expect(frozen.projectiles.length).toBe(1) // exactly one shot, no burst
  await page.waitForTimeout(500)
  const stillFrozen = await snapshot(page)
  expect(stillFrozen.projectiles).toEqual(frozen.projectiles)
  expect(stillFrozen.enemies).toEqual(frozen.enemies)

  await page.evaluate(() => window.__gameTest?.resume())
  await expect
    .poll(async () => {
      const current = await snapshot(page)
      const ball = current.projectiles.find((p) => p.id === frozen.projectiles[0]!.id)
      return ball ? Math.hypot(ball.x - frozen.projectiles[0]!.x, ball.y - frozen.projectiles[0]!.y) : 999
    })
    .toBeGreaterThan(10)
  expect((await snapshot(page)).enemies.find((entry) => entry.id === id)).toBeTruthy()
  expect(errors).toEqual([])
})

test('remount clears shooters, cooldowns, projectiles and counters', async ({ page }) => {
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  await spawn(page, 'shooter', 400, 480, -2.513)
  await expect
    .poll(async () => {
      const snap = await snapshot(page)
      return snap.projectiles.length + snap.totalEnemyProjectileHits
    })
    .toBeGreaterThan(0)

  await remountGame(page)

  const fresh = await snapshot(page)
  expect(fresh.enemies).toHaveLength(0)
  expect(fresh.projectiles).toHaveLength(0)
  expect(fresh.totalEnemyProjectileHits).toBe(0)
  expect(errors).toEqual([])
})
