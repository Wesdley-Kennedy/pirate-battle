import { expect, test } from '@playwright/test'
import {
  collectErrors,
  distanceTo,
  driveToward,
  gotoRunningGame,
  snapshot,
  startEnemySweeper,
  startGameFromMenu,
  steerTo,
} from './gameTest'

test('arena, islands and a valid spawn are present and deterministic across reloads', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  const first = await snapshot(page)
  expect(first.arena).toEqual({ width: 1600, height: 900 })
  expect(first.islands).toHaveLength(3)

  // Spawn validity: inside bounds with margin, outside every island.
  const radius = first.player.collisionRadius
  expect(first.player.x).toBeGreaterThanOrEqual(radius)
  expect(first.player.x).toBeLessThanOrEqual(first.arena.width - radius)
  expect(first.player.y).toBeGreaterThanOrEqual(radius)
  expect(first.player.y).toBeLessThanOrEqual(first.arena.height - radius)
  for (const island of first.islands) {
    expect(Math.hypot(first.player.x - island.x, first.player.y - island.y)).toBeGreaterThanOrEqual(
      radius + island.radius,
    )
  }

  await page.reload() // lands on the Main Menu; start a fresh match
  await startGameFromMenu(page)
  const second = await snapshot(page)
  expect(second.player).toEqual(first.player)
  expect(second.islands).toEqual(first.islands)
  expect(errors).toEqual([])
})

test('holding W against the left wall never leaves the arena', async ({ page }) => {
  await gotoRunningGame(page)

  // Any heading with a -x component converges onto the wall clamp, so a
  // very loose steering tolerance keeps this robust under CI load.
  await steerTo(page, -Math.PI / 2, 1.0)
  await page.keyboard.down('KeyW')
  // Converges onto the wall contact line x = collisionRadius.
  await expect.poll(async () => (await snapshot(page)).player.x, { timeout: 15000 }).toBeLessThan(31)
  await page.waitForTimeout(600) // keep pressing into the wall
  const settled = await snapshot(page)
  await page.keyboard.up('KeyW')

  expect(settled.player.x).toBeGreaterThanOrEqual(settled.player.collisionRadius - 0.01)
  expect(settled.player.x).toBeLessThanOrEqual(settled.player.collisionRadius + 0.01)
})

test('island blocks the ship; turning, sliding and leaving all work', async ({ page }) => {
  test.slow() // long closed-loop journey: homing, pressing, turning, leaving
  const errors = collectErrors(page)
  await gotoRunningGame(page)
  // Pure-movement test: keep periodic spawns from killing the player.
  const stopSweeper = startEnemySweeper(page)

  const start = await snapshot(page)
  const island = start.islands.find((entry) => entry.id === 'island-south')!
  const combined = island.radius + start.player.collisionRadius

  // 1) Home in on the island: contact is reached (distance can never go
  // below the combined radius) and holding W keeps pressing without
  // penetration.
  await driveToward(page, 'island-south', combined + 2)
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(700) // keep pushing
  // Contact was reached by driveToward; while pressing, the only hard
  // guarantee is non-penetration (an oblique heading may already be
  // sliding the ship around the coast).
  let snap = await snapshot(page)
  expect(distanceTo(snap, 'island-south')).toBeGreaterThanOrEqual(combined - 0.01)

  // 2) Turning while pressed against the island still works.
  const rotationBefore = snap.player.rotation
  await page.keyboard.down('KeyA')
  await expect
    .poll(async () => (await snapshot(page)).player.rotation)
    .toBeLessThan(rotationBefore - 0.6)
  await page.keyboard.up('KeyA')

  // 3) Sliding: with an oblique heading the ship keeps making progress.
  // How oblique the final heading is varies with key latency, so poll for
  // displacement instead of assuming a slide speed.
  const beforeSlide = await snapshot(page)
  await expect
    .poll(
      async () => {
        const current = await snapshot(page)
        return Math.hypot(
          current.player.x - beforeSlide.player.x,
          current.player.y - beforeSlide.player.y,
        )
      },
      { timeout: 10000 },
    )
    .toBeGreaterThan(40)
  snap = await snapshot(page)
  expect(distanceTo(snap, 'island-south')).toBeGreaterThanOrEqual(combined - 0.01)

  // 4) Keep going: the ship leaves the island completely.
  await expect
    .poll(async () => distanceTo(await snapshot(page), 'island-south'), { timeout: 15000 })
    .toBeGreaterThan(combined + 60)
  await page.keyboard.up('KeyW')
  await stopSweeper()
  expect(errors).toEqual([])
})

test('resize changes only presentation, never simulation coordinates', async ({ page }) => {
  await gotoRunningGame(page)

  // Move a bit so the position is not just the spawn constant.
  await page.keyboard.down('KeyW')
  await expect.poll(async () => (await snapshot(page)).player.y).toBeLessThan(690)
  await page.keyboard.up('KeyW')
  await page.waitForTimeout(100)

  const before = await snapshot(page)
  await page.setViewportSize({ width: 520, height: 820 })
  await page.waitForTimeout(300)
  const after = await snapshot(page)

  expect(after.player.x).toBe(before.player.x)
  expect(after.player.y).toBe(before.player.y)
  expect(after.player.rotation).toBe(before.player.rotation)
  expect(after.arena).toEqual(before.arena)
  await expect(page.locator('.game-stage canvas')).toBeVisible()
})
