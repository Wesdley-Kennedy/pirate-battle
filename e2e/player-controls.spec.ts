import { expect, test } from '@playwright/test'
import { SPAWN, collectErrors, gotoRunningGame, remountGame, snapshot, tapKey, wrapAngle } from './gameTest'

test('player appears at the known spawn position', async ({ page }) => {
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  const snap = await snapshot(page)
  expect(snap.player.x).toBe(SPAWN.x)
  expect(snap.player.y).toBe(SPAWN.y)
  expect(snap.player.rotation).toBe(0)
  expect(errors).toEqual([])
})

test('holding W moves the ship forward at the configured speed', async ({ page }) => {
  await gotoRunningGame(page)

  await page.keyboard.down('KeyW')
  await expect.poll(async () => (await snapshot(page)).player.y).toBeLessThan(SPAWN.y - 20)
  const first = await snapshot(page)
  await page.waitForTimeout(500)
  const second = await snapshot(page)
  await page.keyboard.up('KeyW')

  // Facing up: pure -y movement, and distance/activeTime must equal the
  // configured moveSpeed (180 px/s). This also catches double-ticking.
  expect(second.player.x).toBeCloseTo(SPAWN.x, 6)
  const distance = first.player.y - second.player.y
  const elapsed = second.activeElapsedSeconds - first.activeElapsedSeconds
  expect(elapsed).toBeGreaterThan(0.2)
  expect(distance / elapsed).toBeGreaterThan(170)
  expect(distance / elapsed).toBeLessThan(190)
})

test('holding A and D rotates the ship in opposite directions', async ({ page }) => {
  await gotoRunningGame(page)

  // Bounded taps + wrap-aware deltas: an unbounded poll-driven hold can
  // overshoot past ±π under CI load and flip the sign of comparisons.
  const start = (await snapshot(page)).player.rotation
  await tapKey(page, 'KeyD', 250)
  await page.waitForTimeout(120)
  const afterRight = (await snapshot(page)).player.rotation
  expect(wrapAngle(afterRight - start)).toBeGreaterThan(0.15)

  await tapKey(page, 'KeyA', 250)
  await page.waitForTimeout(120)
  const afterLeft = (await snapshot(page)).player.rotation
  expect(wrapAngle(afterLeft - afterRight)).toBeLessThan(-0.15)
  expect((await snapshot(page)).player.x).toBe(SPAWN.x) // rotation alone never moves
})

test('W+A moves and turns simultaneously', async ({ page }) => {
  await gotoRunningGame(page)

  await page.keyboard.down('KeyW')
  await page.keyboard.down('KeyA')
  await expect.poll(async () => (await snapshot(page)).player.rotation).toBeLessThan(-0.2)
  const snap = await snapshot(page)
  await page.keyboard.up('KeyW')
  await page.keyboard.up('KeyA')

  expect(Math.hypot(snap.player.x - SPAWN.x, snap.player.y - SPAWN.y)).toBeGreaterThan(5)
})

test('releasing a key stops that intent', async ({ page }) => {
  await gotoRunningGame(page)

  await page.keyboard.down('KeyW')
  await expect.poll(async () => (await snapshot(page)).player.y).toBeLessThan(SPAWN.y - 10)
  await page.keyboard.up('KeyW')

  // Allow in-flight movement to settle, then verify full stop.
  await page.waitForTimeout(150)
  const stopped = await snapshot(page)
  await page.waitForTimeout(400)
  const later = await snapshot(page)
  expect(later.player.x).toBeCloseTo(stopped.player.x, 6)
  expect(later.player.y).toBeCloseTo(stopped.player.y, 6)
  expect(later.player.rotation).toBeCloseTo(stopped.player.rotation, 6)
})

test('remount creates a fresh session with no stuck keys', async ({ page }) => {
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  // Move, then unmount while W is still physically held down.
  await page.keyboard.down('KeyW')
  await expect.poll(async () => (await snapshot(page)).player.y).toBeLessThan(SPAWN.y - 10)
  await remountGame(page)

  // Fresh session at the spawn; the held key must NOT leak into it.
  await page.waitForTimeout(400)
  const fresh = await snapshot(page)
  expect(fresh.player.x).toBe(SPAWN.x)
  expect(fresh.player.y).toBe(SPAWN.y)

  // Controls still work exactly once after remount.
  await page.keyboard.up('KeyW')
  await page.keyboard.down('KeyW')
  await expect.poll(async () => (await snapshot(page)).player.y).toBeLessThan(SPAWN.y - 10)
  await page.keyboard.up('KeyW')
  expect(errors).toEqual([])
})
