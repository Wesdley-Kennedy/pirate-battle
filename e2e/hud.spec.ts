import { expect, test, type Page } from '@playwright/test'
import { collectErrors, gotoRunningGame, lifecycleOf, snapshot } from './gameTest'

const pauseGame = (page: Page) => page.evaluate(() => window.__gameTest?.pause())
const resumeGame = (page: Page) => page.evaluate(() => window.__gameTest?.resume())

test('HUD shows initial health, score and a formatted countdown with semantic labels', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  await expect(page.locator('[aria-label="Health: 100 of 100"]')).toBeVisible()
  await expect(page.locator('[aria-label="Score: 0"]')).toBeVisible()
  await expect(page.locator('[aria-label^="Time remaining:"]')).toBeVisible()
  await expect(page.getByText(/^[12]:\d{2}$/)).toBeVisible() // M:SS format
  await expect(page.getByRole('button', { name: 'Pause (P)' })).toBeVisible()

  // Countdown ticks down in whole displayed seconds.
  const first = await page.getByText(/^[12]:\d{2}$/).textContent()
  await page.waitForTimeout(1600)
  const second = await page.getByText(/^[12]:\d{2}$/).textContent()
  expect(second).not.toBe(first)
  expect(errors).toEqual([])
})

test('taking damage updates the HUD health; a kill updates the score', async ({ page }) => {
  test.slow()
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  // Damage: an aligned shooter lands one 10-damage ball.
  await pauseGame(page)
  const shooterId = await page.evaluate(() =>
    window.__gameTest!.spawnEnemy('shooter', 400, 480, -2.513),
  )
  await resumeGame(page)
  await expect(page.locator('[aria-label="Health: 90 of 100"]')).toBeVisible({ timeout: 10000 })

  // Kill: remove the attacker, then gun down a held target dead ahead.
  await page.evaluate((id) => window.__gameTest!.removeEnemy(id), shooterId)
  await pauseGame(page)
  await page.evaluate(() => {
    const id = window.__gameTest!.spawnEnemy('shooter', 240, 450)
    window.__gameTest!.setEnemyDrive(id, null, false)
  })
  await resumeGame(page)
  await page.keyboard.down('Space')
  await expect(page.locator('[aria-label="Score: 1"]')).toBeVisible({ timeout: 15000 })
  await page.keyboard.up('Space')

  const snap = await snapshot(page)
  expect(snap.score).toBe(1)
  expect(errors).toEqual([])
})

test('restart resets the HUD to the initial state', async ({ page }) => {
  test.slow()
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  // Take some damage, then finish the match quickly and restart.
  await pauseGame(page)
  await page.evaluate(() => window.__gameTest!.spawnEnemy('shooter', 400, 480, -2.513))
  await resumeGame(page)
  await expect(page.locator('[aria-label="Health: 90 of 100"]')).toBeVisible({ timeout: 10000 })

  await page.evaluate(() => {
    const api = window.__gameTest!
    for (let i = 0; i < 130; i += 1) {
      for (const enemy of api.snapshot().enemies) api.removeEnemy(enemy.id)
      api.advanceTime(1)
      if (api.snapshot().lifecycle !== 'running') break
    }
  })
  await expect.poll(() => lifecycleOf(page)).toBe('ended')
  await page.getByRole('button', { name: 'Play Again' }).click()
  await expect.poll(() => lifecycleOf(page)).toBe('running')

  await expect(page.locator('[aria-label="Health: 100 of 100"]')).toBeVisible()
  await expect(page.locator('[aria-label="Score: 0"]')).toBeVisible()
  await expect(page.getByText(/^[12]:\d{2}$/)).toBeVisible()
  expect(errors).toEqual([])
})

test('controls legend is visible and the layout survives a narrow viewport', async ({ page }) => {
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  const legend = page.locator('.controls-legend')
  await expect(legend).toBeVisible()
  await expect(legend.getByText('Front cannon')).toBeVisible()
  await expect(legend.getByText('Pause / resume')).toBeVisible()

  await page.setViewportSize({ width: 560, height: 760 })
  await page.waitForTimeout(300)
  // No horizontal overflow and the HUD stays visible and usable.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
  await expect(page.locator('[aria-label^="Health:"]')).toBeVisible()
  await expect(page.locator('[aria-label^="Score:"]')).toBeVisible()
  await expect(page.locator('.game-stage canvas')).toBeVisible()
  expect(errors).toEqual([])
})
