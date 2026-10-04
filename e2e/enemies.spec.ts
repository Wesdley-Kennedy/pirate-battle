import { expect, test, type Page } from '@playwright/test'
import { collectErrors, gotoRunningGame, remountGame, snapshot } from './gameTest'

function spawn(page: Page, type: 'chaser' | 'shooter', x: number, y: number, rotation = 0) {
  return page.evaluate(
    (args) => window.__gameTest!.spawnEnemy(args.type, args.x, args.y, args.rotation),
    { type, x, y, rotation },
  )
}

function drive(page: Page, id: number, targetHeading: number | null, forward: boolean) {
  return page.evaluate(
    (args) => window.__gameTest!.setEnemyDrive(args.id, args.targetHeading, args.forward),
    { id, targetHeading, forward },
  )
}

async function enemyById(page: Page, id: number) {
  const snap = await snapshot(page)
  const enemy = snap.enemies.find((entry) => entry.id === id)
  if (!enemy) throw new Error(`enemy ${id} not found`)
  return enemy
}

test('chaser and shooter spawn with correct types and exact logical positions', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  // Pause first: since PHASE 8 the chaser pursues immediately, so exact
  // spawn positions are only observable with the simulation frozen.
  await page.evaluate(() => window.__gameTest?.pause())
  const chaserId = await spawn(page, 'chaser', 600, 450, 0.5)
  const shooterId = await spawn(page, 'shooter', 1000, 500, -1)

  const snap = await snapshot(page)
  expect(snap.enemies).toHaveLength(2)
  const chaser = snap.enemies.find((enemy) => enemy.id === chaserId)!
  const shooter = snap.enemies.find((enemy) => enemy.id === shooterId)!
  expect(chaser.type).toBe('chaser')
  expect(shooter.type).toBe('shooter')
  expect(chaser.x).toBe(600)
  expect(chaser.y).toBe(450)
  expect(chaser.rotation).toBe(0.5)
  expect(shooter.x).toBe(1000)
  await page.evaluate(() => window.__gameTest?.resume())
  expect(errors).toEqual([])
})

test('invalid enemy spawns are rejected by the simulation', async ({ page }) => {
  await gotoRunningGame(page)

  const outcomes = await page.evaluate(() => {
    const attempts: string[] = []
    const probe = (fn: () => void) => {
      try {
        fn()
        attempts.push('accepted')
      } catch {
        attempts.push('rejected')
      }
    }
    probe(() => window.__gameTest!.spawnEnemy('chaser', 5, 450)) // outside arena
    probe(() => window.__gameTest!.spawnEnemy('shooter', 450, 270)) // inside island-west
    probe(() => window.__gameTest!.spawnEnemy('chaser', 245, 705)) // on top of the player
    return attempts
  })
  expect(outcomes).toEqual(['rejected', 'rejected', 'rejected'])
  expect((await snapshot(page)).enemies).toHaveLength(0)
})

test('a driven enemy presses against an island without penetrating, then sails away', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  // Below island-south (800, 650), facing up: drives straight into it.
  // Spawn + manual drive under pause so the Shooter AI never runs in the
  // gap between the two calls (full determinism under load).
  await page.evaluate(() => window.__gameTest?.pause())
  const id = await spawn(page, 'shooter', 800, 850, 0)
  await drive(page, id, 0, true)
  await page.evaluate(() => window.__gameTest?.resume())

  const combined = 88 + 30
  await expect
    .poll(
      async () => {
        const enemy = await enemyById(page, id)
        return Math.hypot(enemy.x - 800, enemy.y - 650)
      },
      { timeout: 10000 },
    )
    .toBeLessThan(combined + 2)
  // Keep pressing: never penetrates.
  await page.waitForTimeout(500)
  const pressed = await enemyById(page, id)
  expect(Math.hypot(pressed.x - 800, pressed.y - 650)).toBeGreaterThanOrEqual(combined - 0.01)

  // Turn around and leave.
  await drive(page, id, Math.PI, true)
  await expect
    .poll(
      async () => {
        const enemy = await enemyById(page, id)
        return Math.hypot(enemy.x - 800, enemy.y - 650)
      },
      { timeout: 10000 },
    )
    .toBeGreaterThan(combined + 60)
  expect(errors).toEqual([])
})

test('a driven enemy never leaves the arena', async ({ page }) => {
  await gotoRunningGame(page)

  await page.evaluate(() => window.__gameTest?.pause())
  const id = await spawn(page, 'shooter', 200, 450, -Math.PI / 2)
  await drive(page, id, null, true)
  await page.evaluate(() => window.__gameTest?.resume())

  await expect
    .poll(async () => (await enemyById(page, id)).x, { timeout: 10000 })
    .toBeLessThan(31)
  await page.waitForTimeout(400)
  const settled = await enemyById(page, id)
  expect(settled.x).toBeGreaterThanOrEqual(29.99)
  expect(settled.x).toBeLessThanOrEqual(30.01)
})

test('logical removal, remount cleanup and resize stability', async ({ page }) => {
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  const chaserId = await spawn(page, 'chaser', 600, 450)
  const shooterId = await spawn(page, 'shooter', 1000, 500)
  // Hold the shooter still (manual drive = full test control) so the
  // resize comparison below sees a static enemy.
  await page.evaluate((id) => window.__gameTest!.setEnemyDrive(id, null, false), shooterId)
  expect((await snapshot(page)).enemies).toHaveLength(2)

  // Logical removal reaches the next snapshot (and the renderer map).
  await page.evaluate((id) => window.__gameTest!.removeEnemy(id), chaserId)
  const afterRemove = await snapshot(page)
  expect(afterRemove.enemies).toHaveLength(1)
  expect(afterRemove.enemies[0]!.type).toBe('shooter')

  // Resize changes only presentation.
  const before = await snapshot(page)
  await page.setViewportSize({ width: 540, height: 760 })
  await page.waitForTimeout(250)
  const after = await snapshot(page)
  expect(after.enemies).toEqual(before.enemies)

  // Remount: fresh session starts without enemies.
  await remountGame(page)
  expect((await snapshot(page)).enemies).toHaveLength(0)
  expect(errors).toEqual([])
})
