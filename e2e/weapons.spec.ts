import { expect, test } from '@playwright/test'
import { SPAWN, collectErrors, gotoRunningGame, lifecycleOf, remountGame, snapshot, tapKey } from './gameTest'

/**
 * Deterministic fire-and-freeze, immune to CDP/CI latency: pause first
 * (holding the key only records intent), then resume + wait two animation
 * frames + pause again INSIDE one page evaluate — so exactly a tick or
 * two run, the held key fires, and the fresh projectiles are frozen a few
 * pixels from their muzzles for leisurely inspection.
 */
async function fireAndFreeze(page: Parameters<typeof snapshot>[0], key: string) {
  await page.evaluate(() => window.__gameTest?.pause())
  await page.keyboard.down(key) // real key; no simulation step runs yet
  await page.evaluate(async () => {
    window.__gameTest!.resume()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    window.__gameTest!.pause()
  })
  await page.keyboard.up(key)
  const frozen = await snapshot(page)
  expect(frozen.lifecycle).toBe('paused')
  return frozen
}

async function resumeGame(page: Parameters<typeof snapshot>[0]) {
  await page.evaluate(() => window.__gameTest?.resume())
}

test('Space fires exactly 1 projectile forward from the bow', async ({ page }) => {
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  const frozen = await fireAndFreeze(page, 'Space')
  // Only a tick or two ran between fire and freeze, far below the 0.5s
  // cooldown: exactly one ball, frozen just ahead of the bow.
  expect(frozen.projectiles).toHaveLength(1)
  const projectile = frozen.projectiles[0]!
  expect(projectile.owner).toBe('player')
  expect(projectile.directionX).toBeCloseTo(0, 6)
  expect(projectile.directionY).toBeCloseTo(-1, 6)
  expect(projectile.y).toBeLessThan(frozen.player.y) // ahead of the bow
  await resumeGame(page)
  expect(errors).toEqual([])
})

test('Q fires 3 parallel projectiles out of the port side', async ({ page }) => {
  await gotoRunningGame(page)

  const frozen = await fireAndFreeze(page, 'KeyQ')
  expect(frozen.projectiles).toHaveLength(3)
  for (const projectile of frozen.projectiles) {
    expect(projectile.directionX).toBeCloseTo(-1, 6) // port at rotation 0 = -x
    expect(projectile.directionY).toBeCloseTo(0, 6)
    expect(projectile.x).toBeLessThan(frozen.player.x)
  }
  const ys = frozen.projectiles.map((p) => p.y).sort((a, b) => a - b)
  expect(ys[1]! - ys[0]!).toBeGreaterThan(20) // distinct origins along the hull
  expect(ys[2]! - ys[1]!).toBeGreaterThan(20)
  await resumeGame(page)
})

test('E fires 3 parallel projectiles out of the starboard side', async ({ page }) => {
  await gotoRunningGame(page)

  const frozen = await fireAndFreeze(page, 'KeyE')
  expect(frozen.projectiles).toHaveLength(3)
  for (const projectile of frozen.projectiles) {
    expect(projectile.directionX).toBeCloseTo(1, 6)
    expect(projectile.directionY).toBeCloseTo(0, 6)
    expect(projectile.x).toBeGreaterThan(frozen.player.x)
  }
  await resumeGame(page)
})

test('W+Space: moving and firing work simultaneously', async ({ page }) => {
  await gotoRunningGame(page)

  await page.keyboard.down('KeyW')
  await page.keyboard.down('Space')
  await expect.poll(async () => (await snapshot(page)).projectiles.length).toBeGreaterThan(0)
  await expect.poll(async () => (await snapshot(page)).player.y).toBeLessThan(SPAWN.y - 20)
  await page.keyboard.up('Space')
  await page.keyboard.up('KeyW')
})

test('W+A+Q: move, turn and broadside all at once', async ({ page }) => {
  await gotoRunningGame(page)

  await page.keyboard.down('KeyW')
  await page.keyboard.down('KeyA')
  await page.keyboard.down('KeyQ')
  await expect.poll(async () => (await snapshot(page)).player.rotation).toBeLessThan(-0.2)
  await expect.poll(async () => (await snapshot(page)).projectiles.length).toBeGreaterThanOrEqual(3)
  const snap = await snapshot(page)
  expect(Math.hypot(snap.player.x - SPAWN.x, snap.player.y - SPAWN.y)).toBeGreaterThan(5)
  await page.keyboard.up('KeyQ')
  await page.keyboard.up('KeyA')
  await page.keyboard.up('KeyW')
})

test('holding Space respects the front cooldown cadence', async ({ page }) => {
  await gotoRunningGame(page)

  await page.keyboard.down('Space')
  const first = await snapshot(page)
  // Third shot requires two full 0.5s cooldowns of active simulation time.
  await expect
    .poll(
      async () => Math.max(0, ...(await snapshot(page)).projectiles.map((p) => p.id)),
      { timeout: 10000 },
    )
    .toBeGreaterThanOrEqual(3)
  const third = await snapshot(page)
  await page.keyboard.up('Space')
  const elapsed = third.activeElapsedSeconds - first.activeElapsedSeconds
  expect(elapsed).toBeGreaterThan(0.95) // cooldown-gated, not one shot per frame
})

test('projectiles vanish on island impact, well before their lifetime', async ({ page }) => {
  await gotoRunningGame(page)

  // Sail up from the spawn in bounded taps (holding W under CI load can
  // overshoot by hundreds of px between polls); near y 300-360 the
  // starboard broadside sweeps right across island-west (450, 270).
  for (let i = 0; i < 40; i += 1) {
    if ((await snapshot(page)).player.y <= 360) break
    await tapKey(page, 'KeyW', 250)
  }
  const shipY = (await snapshot(page)).player.y
  expect(shipY).toBeLessThanOrEqual(360)
  expect(shipY).toBeGreaterThan(177) // keeps the center ball inside the hit band

  // The balls only live ~200ms before sweeping across island-west, so
  // instead of racing to observe them mid-flight, use the session's
  // cumulative counters: 3 shots fired, at least one island impact.
  const before = await snapshot(page)
  await tapKey(page, 'KeyE')
  await expect
    .poll(async () => (await snapshot(page)).totalShotsFired)
    .toBe(before.totalShotsFired + 3)
  await expect
    .poll(async () => (await snapshot(page)).totalIslandImpacts, { timeout: 10000 })
    .toBeGreaterThanOrEqual(before.totalIslandImpacts + 1)
  await expect
    .poll(async () => (await snapshot(page)).projectiles.length, { timeout: 10000 })
    .toBe(0)
})

test('projectiles expire in open water at the configured lifetime', async ({ page }) => {
  await gotoRunningGame(page)

  const before = await snapshot(page)
  await tapKey(page, 'Space') // fired upward into open water
  await expect
    .poll(async () => (await snapshot(page)).totalShotsFired)
    .toBe(before.totalShotsFired + 1)
  await expect.poll(async () => (await snapshot(page)).projectiles.length).toBe(1)
  const fired = await snapshot(page)

  await expect
    .poll(async () => (await snapshot(page)).projectiles.length, { timeout: 10000 })
    .toBe(0)
  const after = await snapshot(page)
  // Removed by expiry, not by hitting anything: no island impact counted,
  // and it survived at least ~a second of flight.
  expect(after.totalIslandImpacts).toBe(before.totalIslandImpacts)
  const flightTime = after.activeElapsedSeconds - fired.activeElapsedSeconds
  expect(flightTime).toBeGreaterThan(1.0)
})

test('pause freezes projectiles and blocks new shots; resume continues cleanly', async ({
  page,
}) => {
  await gotoRunningGame(page)

  await tapKey(page, 'KeyQ') // 3 balls heading into open water (-x)
  await expect.poll(async () => (await snapshot(page)).projectiles.length).toBe(3)
  await page.evaluate(() => window.__gameTest?.pause())

  const frozen = await snapshot(page)
  await page.keyboard.down('Space') // held during pause: must not spawn
  await page.waitForTimeout(400)
  const stillFrozen = await snapshot(page)
  await page.keyboard.up('Space')

  expect(stillFrozen.lifecycle).toBe('paused')
  expect(stillFrozen.projectiles).toEqual(frozen.projectiles) // positions + lifetimes identical
  expect(stillFrozen.weaponCooldowns).toEqual(frozen.weaponCooldowns)

  await page.evaluate(() => window.__gameTest?.resume())
  await expect.poll(() => lifecycleOf(page)).toBe('running')
  // No burst: the ball count never exceeds the 3 frozen ones.
  const resumed = await snapshot(page)
  expect(resumed.projectiles.length).toBeLessThanOrEqual(3)
  // And they keep moving from where they stopped.
  await expect
    .poll(async () => {
      const current = await snapshot(page)
      const match = current.projectiles.find((p) => p.id === frozen.projectiles[0]!.id)
      return match ? Math.abs(match.x - frozen.projectiles[0]!.x) : Number.POSITIVE_INFINITY
    })
    .toBeGreaterThan(10)
})

test('remount resets projectiles, cooldowns and ids with no stuck fire keys', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  await tapKey(page, 'KeyE')
  await expect.poll(async () => (await snapshot(page)).projectiles.length).toBe(3)

  await page.keyboard.down('KeyQ') // still held across the unmount
  await remountGame(page)
  await page.keyboard.up('KeyQ')

  await page.waitForTimeout(300)
  const fresh = await snapshot(page)
  expect(fresh.projectiles).toHaveLength(0) // nothing leaked, no stuck Q
  expect(fresh.weaponCooldowns).toEqual({ front: 0, left: 0, right: 0 })

  await tapKey(page, 'Space')
  await expect.poll(async () => (await snapshot(page)).projectiles.length).toBe(1)
  expect((await snapshot(page)).projectiles[0]!.id).toBe(1) // per-session ids restart
  expect(errors).toEqual([])
})
