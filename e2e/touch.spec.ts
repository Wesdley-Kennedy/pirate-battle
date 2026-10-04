import { expect, test, type Page } from '@playwright/test'
import {
  collectErrors,
  exitToMenu,
  gotoRunningGame,
  snapshot,
  startEnemySweeper,
  startGameFromMenu,
} from './gameTest'

/**
 * Touch controls. `hasTouch` makes navigator.maxTouchPoints > 0, which
 * is exactly what the app uses to decide to render the touch pads.
 * Buttons are driven with raw pointer events (distinct pointerIds) —
 * the same code path real touches take through React's handlers,
 * including true multi-touch combinations.
 */
test.use({ hasTouch: true, viewport: { width: 900, height: 480 } })

function touchPad(page: Page, action: string) {
  return page.locator(`[data-touch="${action}"]`)
}

async function touchDown(page: Page, action: string, pointerId: number): Promise<void> {
  await touchPad(page, action).dispatchEvent('pointerdown', {
    pointerId,
    pointerType: 'touch',
    bubbles: true,
  })
}

async function touchUp(page: Page, action: string, pointerId: number): Promise<void> {
  await touchPad(page, action).dispatchEvent('pointerup', {
    pointerId,
    pointerType: 'touch',
    bubbles: true,
  })
}

/** Samples the player position twice with every enemy swept away in
 * between, proving the ship is standing still (intent fully cleared). */
async function expectShipStandsStill(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = window.__gameTest!
    for (const enemy of api.snapshot().enemies) api.removeEnemy(enemy.id)
  })
  const first = await snapshot(page)
  await page.waitForTimeout(400)
  const second = await snapshot(page)
  expect(second.player.x).toBe(first.player.x)
  expect(second.player.y).toBe(first.player.y)
}

test('touch pads render on touch devices and holding Forward moves the ship until release', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  // All six pads are present (3 movement left, 3 attacks right).
  for (const action of ['forward', 'turnLeft', 'turnRight', 'fireFront', 'fireLeft', 'fireRight']) {
    await expect(touchPad(page, action)).toBeVisible()
  }

  const before = await snapshot(page)
  await touchDown(page, 'forward', 1)
  await expect
    .poll(async () => (await snapshot(page)).player.y, { timeout: 10000 })
    .toBeLessThan(before.player.y - 20)
  await touchUp(page, 'forward', 1)
  await page.waitForTimeout(200) // release reaches the simulation
  await expectShipStandsStill(page)
  expect(errors).toEqual([])
})

test('touch turn pads rotate the ship both ways', async ({ page }) => {
  await gotoRunningGame(page)

  const start = (await snapshot(page)).player.rotation
  await touchDown(page, 'turnRight', 1)
  await expect
    .poll(async () => (await snapshot(page)).player.rotation, { timeout: 10000 })
    .toBeGreaterThan(start + 0.4)
  await touchUp(page, 'turnRight', 1)

  const mid = (await snapshot(page)).player.rotation
  await touchDown(page, 'turnLeft', 2)
  await expect
    .poll(async () => (await snapshot(page)).player.rotation, { timeout: 10000 })
    .toBeLessThan(mid - 0.4)
  await touchUp(page, 'turnLeft', 2)
})

test('touch fire pads shoot the front cannon and the broadsides', async ({ page }) => {
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  const before = (await snapshot(page)).totalShotsFired
  await touchDown(page, 'fireFront', 1)
  await expect
    .poll(async () => (await snapshot(page)).totalShotsFired, { timeout: 10000 })
    .toBeGreaterThanOrEqual(before + 1)
  await touchUp(page, 'fireFront', 1)

  // A broadside launches 3 parallel projectiles at once.
  const beforeBroadside = (await snapshot(page)).totalShotsFired
  await touchDown(page, 'fireLeft', 2)
  await expect
    .poll(async () => (await snapshot(page)).totalShotsFired, { timeout: 10000 })
    .toBeGreaterThanOrEqual(beforeBroadside + 3)
  await touchUp(page, 'fireLeft', 2)
  expect(errors).toEqual([])
})

test('multi-touch: hold Forward + Turn while tapping Fire — all three act together', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  const before = await snapshot(page)
  await touchDown(page, 'forward', 1)
  await touchDown(page, 'turnRight', 2)
  await touchDown(page, 'fireFront', 3)

  await expect
    .poll(
      async () => {
        const snap = await snapshot(page)
        const moved = Math.hypot(snap.player.x - before.player.x, snap.player.y - before.player.y)
        const turned = snap.player.rotation - before.player.rotation
        const fired = snap.totalShotsFired - before.totalShotsFired
        return moved > 15 && turned > 0.3 && fired >= 1
      },
      { timeout: 10000 },
    )
    .toBe(true)

  await touchUp(page, 'fireFront', 3)
  await touchUp(page, 'turnRight', 2)
  await touchUp(page, 'forward', 1)
  expect(errors).toEqual([])
})

test('pointercancel clears the held intent', async ({ page }) => {
  await gotoRunningGame(page)
  const stopSweeper = startEnemySweeper(page)

  const before = await snapshot(page)
  await touchDown(page, 'forward', 7)
  await expect
    .poll(async () => (await snapshot(page)).player.y, { timeout: 10000 })
    .toBeLessThan(before.player.y - 10)

  // The browser steals the pointer (system gesture, palm rejection…).
  await touchPad(page, 'forward').dispatchEvent('pointercancel', {
    pointerId: 7,
    pointerType: 'touch',
    bubbles: true,
  })
  await page.waitForTimeout(200)
  await expectShipStandsStill(page)
  await stopSweeper()
})

test('leaving the match with a pad still held never leaks into the next match', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  await touchDown(page, 'forward', 1)
  await expect
    .poll(async () => (await snapshot(page)).player.y, { timeout: 10000 })
    .toBeLessThan(690)
  // Abandon mid-hold: pause (pads unmount, intents cleared) → Main Menu.
  await exitToMenu(page)

  // A fresh match starts perfectly still: nothing survived the teardown.
  await startGameFromMenu(page)
  await page.waitForTimeout(600)
  const fresh = await snapshot(page)
  expect(fresh.player.x).toBe(240)
  expect(fresh.player.y).toBe(700)
  expect(errors).toEqual([])
})

test('phone-sized viewport: no horizontal overflow and a portrait rotate hint', async ({
  page,
}) => {
  await page.setViewportSize({ width: 740, height: 360 })
  await gotoRunningGame(page)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
  await expect(page.locator('.rotate-hint')).toBeHidden() // landscape

  await page.setViewportSize({ width: 420, height: 800 })
  await expect(page.locator('.rotate-hint')).toBeVisible() // portrait
  // The match itself keeps running untouched by the resize.
  await expect(page.locator('.game-stage canvas')).toBeVisible()
})
