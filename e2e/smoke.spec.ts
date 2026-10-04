import { expect, test } from '@playwright/test'

test('application boots to the menu and Play starts the game', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Pirate Battle' })).toBeVisible()
  await expect(page.locator('.game-stage canvas')).toHaveCount(0) // menu: no Pixi
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.locator('.game-stage canvas')).toHaveCount(1, { timeout: 15000 })
})
