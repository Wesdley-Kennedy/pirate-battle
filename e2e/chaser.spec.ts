import { expect, test, type Page } from '@playwright/test'
import { collectErrors, gotoRunningGame, remountGame, snapshot } from './gameTest'

function spawn(page: Page, type: 'chaser' | 'shooter', x: number, y: number, rotation = 0) {
  return page.evaluate(
    (args) => window.__gameTest!.spawnEnemy(args.type, args.x, args.y, args.rotation),
    { type, x, y, rotation },
  )
}

async function chaserPlayerDistance(page: Page, id: number): Promise<number> {
  const snap = await snapshot(page)
  const enemy = snap.enemies.find((entry) => entry.id === id)
  if (!enemy) return 0 // already impacted
  return Math.hypot(enemy.x - snap.player.x, enemy.y - snap.player.y)
}

test('a spawned chaser pursues on its own and the distance shrinks', async ({ page }) => {
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  // Open corridor to the player at (240, 700) — no manual drive at all.
  const id = await spawn(page, 'chaser', 800, 450)
  const first = await chaserPlayerDistance(page, id)
  await page.waitForTimeout(900)
  const second = await chaserPlayerDistance(page, id)
  expect(second).toBeLessThan(first - 60)

  // Heading converges onto the player direction.
  const snap = await snapshot(page)
  const enemy = snap.enemies.find((entry) => entry.id === id)!
  const expected = Math.atan2(snap.player.x - enemy.x, -(snap.player.y - enemy.y))
  const twoPi = Math.PI * 2
  const error = Math.abs(((((expected - enemy.rotation + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI)
  expect(error).toBeLessThan(0.5)
  expect(errors).toEqual([])
})

test('the chaser re-aims while the player moves', async ({ page }) => {
  await gotoRunningGame(page)

  const id = await spawn(page, 'chaser', 240, 150) // straight above the player
  await page.waitForTimeout(700)
  const before = (await snapshot(page)).enemies.find((entry) => entry.id === id)!

  await page.keyboard.down('KeyD') // rotate east
  await page.waitForTimeout(500)
  await page.keyboard.up('KeyD')
  await page.keyboard.down('KeyW') // sail away eastwards
  await page.waitForTimeout(1200)
  await page.keyboard.up('KeyW')

  const after = (await snapshot(page)).enemies.find((entry) => entry.id === id)
  if (after) {
    expect(Math.abs(after.rotation - before.rotation)).toBeGreaterThan(0.15)
  }
  // (If it already impacted the moving player, pursuit obviously re-aimed.)
})

test('pursuit around an island: the chaser clips the corner, never penetrates, and still impacts', async ({
  page,
}) => {
  test.slow()
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  // From (1100, 500) the straight line to the player passes ~78 px from
  // island-south's center — the chaser must slide around the coast.
  const id = await spawn(page, 'chaser', 1100, 500)

  // Track OUR chaser by id: the periodic spawner (PHASE 11) adds other
  // enemies during this long window, so global counts are not isolated.
  const minDistances: number[] = []
  let ourChaserGone = false
  const deadline = Date.now() + 25000
  while (Date.now() < deadline) {
    const snap = await snapshot(page)
    const enemy = snap.enemies.find((entry) => entry.id === id)
    if (!enemy) {
      ourChaserGone = true // chasers only leave by self-destructing on the player
      break
    }
    const island = snap.islands.find((entry) => entry.id === 'island-south')!
    minDistances.push(Math.hypot(enemy.x - island.x, enemy.y - island.y))
    await page.waitForTimeout(120)
  }

  expect(ourChaserGone).toBe(true) // got around the island and impacted
  expect((await snapshot(page)).totalChaserImpacts).toBeGreaterThanOrEqual(1)
  for (const distance of minDistances) {
    expect(distance).toBeGreaterThanOrEqual(118 - 0.01) // never inside the island
  }
  expect(errors).toEqual([])
})

test('impact self-destructs the chaser exactly once; shooter stays put through it all', async ({
  page,
}) => {
  test.slow() // 4 s sim journey can stretch well past 30 s under suite load
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  // Spawn both under pause so the shooter's hold-still manual drive is in
  // place before any simulation step runs (PHASE 9 gave shooters an AI).
  await page.evaluate(() => window.__gameTest?.pause())
  const shooterId = await spawn(page, 'shooter', 1300, 200, 1)
  await page.evaluate((id) => window.__gameTest!.setEnemyDrive(id, null, false), shooterId)
  const chaserId = await spawn(page, 'chaser', 800, 450) // clear line to the player
  await page.evaluate(() => window.__gameTest?.resume())

  await expect
    .poll(async () => (await snapshot(page)).totalChaserImpacts, { timeout: 20000 })
    .toBeGreaterThanOrEqual(1)
  const snap = await snapshot(page)
  // Our chaser self-destructed (its id is gone — the double-impact
  // impossibility is pinned down by unit tests; the periodic spawner may
  // have added unrelated enemies meanwhile).
  expect(snap.enemies.find((entry) => entry.id === chaserId)).toBeUndefined()
  const shooter = snap.enemies.find((entry) => entry.id === shooterId)!
  expect(shooter.x).toBe(1300) // held perfectly still by the manual drive
  expect(shooter.y).toBe(200)
  expect(shooter.rotation).toBe(1)
  expect(errors).toEqual([])
})

test('pause freezes pursuit and resume continues; remount clears everything', async ({ page }) => {
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  const id = await spawn(page, 'chaser', 1200, 700)
  await page.waitForTimeout(500)
  await page.evaluate(() => window.__gameTest?.pause())
  const frozen = (await snapshot(page)).enemies.find((entry) => entry.id === id)!
  await page.waitForTimeout(500)
  const stillFrozen = (await snapshot(page)).enemies.find((entry) => entry.id === id)!
  expect(stillFrozen).toEqual(frozen)

  await page.evaluate(() => window.__gameTest?.resume())
  await expect
    .poll(async () => {
      const enemy = (await snapshot(page)).enemies.find((entry) => entry.id === id)
      return enemy ? Math.hypot(enemy.x - frozen.x, enemy.y - frozen.y) : 999
    })
    .toBeGreaterThan(10)

  await remountGame(page)
  const fresh = await snapshot(page)
  expect(fresh.enemies).toHaveLength(0)
  expect(fresh.totalChaserImpacts).toBe(0)
  expect(errors).toEqual([])
})
