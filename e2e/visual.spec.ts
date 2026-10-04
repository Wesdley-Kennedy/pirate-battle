import { expect, test, type Page } from '@playwright/test'
import { gotoRunningGame, lifecycleOf, snapshot } from './gameTest'

/**
 * Visual regression baselines. Every state is made deterministic first:
 * the match is paused (frozen simulation, stable HUD numbers) and enemy
 * positions are set through the test API before the screenshot. The
 * animated low-time pulse is disabled via `animations: 'disabled'`.
 */

test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })

async function freezeAt(page: Page): Promise<void> {
  await page.evaluate(() => window.__gameTest?.pause())
  await page.waitForTimeout(250) // let the last frame settle
}

test('visual: main menu', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Scurvy Sam')).toBeVisible() // ranking settled
  await page.locator('body').click({ position: { x: 5, y: 5 } }) // drop focus rings
  await expect(page.locator('.menu-screen')).toHaveScreenshot('main-menu.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
  })
})

test('visual: options screen', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Options' }).click()
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await expect(page.locator('.menu-screen')).toHaveScreenshot('options-screen.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
  })
})

test('visual: main menu on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 900 })
  await page.goto('/')
  await expect(page.getByText('Scurvy Sam')).toBeVisible()
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await expect(page.locator('.menu-screen')).toHaveScreenshot('main-menu-narrow.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
  })
})

test('visual: initial arena with HUD', async ({ page }) => {
  await gotoRunningGame(page)
  await freezeAt(page)
  await expect(page.locator('.game-stage')).toHaveScreenshot('arena-initial.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
    // The pause lands a nondeterministic fraction of a second after load:
    // mask the timer counter (120 vs 119) — everything else is frozen.
    mask: [page.locator('.hud-counter').first()],
  })
})

test('visual: paused state with enemies and health bars', async ({ page }) => {
  await gotoRunningGame(page)
  await page.evaluate(() => {
    const api = window.__gameTest!
    api.pause()
    api.spawnEnemy('chaser', 620, 430, 0.9)
    api.spawnEnemy('shooter', 1050, 560, -2.1)
  })
  await page.waitForTimeout(250)
  await expect(page.locator('.game-stage')).toHaveScreenshot('paused-enemies.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
    mask: [page.locator('.hud-counter').first()],
  })
})

test('visual: ended state overlay', async ({ page }) => {
  await gotoRunningGame(page)
  await page.evaluate(() => {
    const api = window.__gameTest!
    for (let i = 0; i < 130; i += 1) {
      for (const enemy of api.snapshot().enemies) api.removeEnemy(enemy.id)
      api.advanceTime(1)
      if (api.snapshot().lifecycle !== 'running') break
    }
  })
  await expect.poll(() => lifecycleOf(page)).toBe('ended')
  expect((await snapshot(page)).endReason).toBe('time-expired')
  // Result registration settles before the shot (no transient "Saving…").
  await expect(page.getByText('Result saved to the leaderboard.')).toBeVisible()
  await page.waitForTimeout(600) // death/end effects fully faded
  await expect(page.locator('.game-stage')).toHaveScreenshot('ended-time-expired.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
    // The frozen arena behind the veil contains the session's random
    // leftovers; mask the canvas and compare the deterministic UI.
    mask: [page.locator('.game-stage__canvas-host')],
  })
})
