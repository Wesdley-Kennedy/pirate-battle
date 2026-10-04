import { expect, test, type Page } from '@playwright/test'
import { collectErrors, gotoRunningGame, remountGame, snapshot } from './gameTest'

function spawn(page: Page, type: 'chaser' | 'shooter', x: number, y: number, rotation = 0) {
  return page.evaluate(
    (args) => window.__gameTest!.spawnEnemy(args.type, args.x, args.y, args.rotation),
    { type, x, y, rotation },
  )
}

const pauseGame = (page: Page) => page.evaluate(() => window.__gameTest?.pause())
const resumeGame = (page: Page) => page.evaluate(() => window.__gameTest?.resume())

test('front cannon chips a shooter down; score flips 0→1 only at the kill', async ({ page }) => {
  test.slow()
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  // Stationary target dead ahead of the spawn-facing player.
  await pauseGame(page)
  const id = await spawn(page, 'shooter', 240, 450)
  await page.evaluate((enemyId) => window.__gameTest!.setEnemyDrive(enemyId, null, false), id)
  await resumeGame(page)

  await page.keyboard.down('Space')
  // First hit: HP drops by the front damage while the score stays 0.
  await expect
    .poll(
      async () => (await snapshot(page)).enemies.find((e) => e.id === id)?.health ?? -1,
      { timeout: 10000 },
    )
    .toBeLessThan(50)
  const midway = await snapshot(page)
  const target = midway.enemies.find((e) => e.id === id)!
  expect(target.health).toBeGreaterThan(0)
  expect(target.health % 10).toBe(0) // multiples of the 10 front damage
  expect(midway.score).toBe(0) // hits never score

  // Keep firing: 5 hits destroy it for exactly +1.
  await expect
    .poll(async () => (await snapshot(page)).score, { timeout: 15000 })
    .toBe(1)
  await page.keyboard.up('Space')
  const after = await snapshot(page)
  expect(after.enemies).toHaveLength(0)
  expect(errors).toEqual([])
})

test('a broadside kills a charging chaser before impact: +1 score, no player damage', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  await pauseGame(page)
  // Pre-aimed at the player so it charges straight down the firing line
  // (spawned facing north it would arc upward while turning, and the
  // outer broadside ball would miss).
  await spawn(page, 'chaser', 390, 700, -Math.PI / 2)
  await page.keyboard.down('KeyE')
  // Latency-proof: fire within a frame or two, then freeze again.
  await page.evaluate(async () => {
    window.__gameTest!.resume()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    window.__gameTest!.pause()
  })
  await page.keyboard.up('KeyE')
  expect((await snapshot(page)).projectiles).toHaveLength(3)

  await resumeGame(page)
  await expect.poll(async () => (await snapshot(page)).score, { timeout: 5000 }).toBe(1)
  const after = await snapshot(page)
  expect(after.enemies).toHaveLength(0)
  expect(after.totalChaserImpacts).toBe(0) // died before reaching the player
  expect(after.player.health).toBe(after.player.maxHealth)
  expect(errors).toEqual([])
})

test('a chaser that reaches the player deals its damage and never scores', async ({ page }) => {
  test.slow()
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  await spawn(page, 'chaser', 800, 450) // clear line to the player
  await expect
    .poll(async () => (await snapshot(page)).totalChaserImpacts, { timeout: 20000 })
    .toBeGreaterThanOrEqual(1)
  const after = await snapshot(page)
  // At least the 25 chaser damage landed (periodic spawns may add more
  // damage under slow CI sampling, but nothing can ever score here).
  expect(after.player.health).toBeLessThanOrEqual(after.player.maxHealth - 25)
  expect(after.score).toBe(0)
  expect(after.player.alive).toBe(true)
  expect(errors).toEqual([])
})

test('shooter projectiles whittle the player down', async ({ page }) => {
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  await pauseGame(page)
  await spawn(page, 'shooter', 400, 480, -2.513) // in range, pre-aligned
  await resumeGame(page)

  await expect
    .poll(async () => (await snapshot(page)).player.health, { timeout: 10000 })
    .toBeLessThan(100)
  const after = await snapshot(page)
  expect(after.player.health).toBe(90) // one 10-damage ball so far
  expect(after.score).toBe(0)
  expect(errors).toEqual([])
})

test('four chaser impacts kill the player: session ends and dead input does nothing', async ({
  page,
}) => {
  test.slow()
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  // 4 × 25 damage = exactly the 100 HP. All four lanes are island-free.
  await spawn(page, 'chaser', 800, 450)
  await spawn(page, 'chaser', 240, 150, Math.PI)
  await spawn(page, 'chaser', 800, 850)
  await spawn(page, 'chaser', 1200, 700)

  await expect
    .poll(async () => (await snapshot(page)).lifecycle, { timeout: 45000 })
    .toBe('ended')
  const dead = await snapshot(page)
  expect(dead.endReason).toBe('player-death')
  expect(dead.player.health).toBe(0)
  expect(dead.player.alive).toBe(false)
  expect(dead.score).toBe(0)

  // Dead player: real keys change nothing.
  const position = { x: dead.player.x, y: dead.player.y }
  await page.keyboard.down('KeyW')
  await page.keyboard.down('Space')
  await page.waitForTimeout(500)
  await page.keyboard.up('Space')
  await page.keyboard.up('KeyW')
  const after = await snapshot(page)
  expect(after.player.x).toBe(position.x)
  expect(after.player.y).toBe(position.y)
  expect(after.projectiles).toHaveLength(0)
  expect(after.lifecycle).toBe('ended')

  // Remount restores a fresh full-health session.
  await remountGame(page)
  const fresh = await snapshot(page)
  expect(fresh.player.health).toBe(fresh.player.maxHealth)
  expect(fresh.score).toBe(0)
  expect(fresh.endReason).toBeNull()
  expect(errors).toEqual([])
})
