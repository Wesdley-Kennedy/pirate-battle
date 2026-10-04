import { expect, test, type Page } from '@playwright/test'
import {
  collectErrors,
  exitToMenu,
  gotoRunningGame,
  lifecycleOf,
  snapshot,
  startGameFromMenu,
} from './gameTest'

const OPTIONS_KEY = 'pirate-battle:options'

async function openOptions(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Options' }).click()
  await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible()
}

test('the app boots to the Main Menu: no Pixi, Play/Options, controls and board tabs', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Pirate Battle' })).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Options' })).toBeVisible()
  await expect(page.getByText('Front cannon')).toBeVisible()

  // Boards show real mocked data (Axios + TanStack Query + MSW).
  await expect(page.getByRole('button', { name: 'Ranking' })).toBeVisible()
  await expect(page.getByText('Scurvy Sam')).toBeVisible()
  await page.getByRole('button', { name: 'Match History' }).click()
  await expect(page.getByText('You have not completed any matches yet.')).toBeVisible()
  expect(errors).toEqual([])
})

test('menu → game → menu cycles never accumulate canvases or sessions', async ({ page }) => {
  test.slow()
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await exitToMenu(page) // asserts 0 canvases on the menu
    await startGameFromMenu(page) // asserts exactly 1 canvas, running
  }
  // Listeners did not accumulate: one blur still pauses exactly once and
  // the game is still fully controllable.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect.poll(() => lifecycleOf(page)).toBe('paused')
  await page.getByRole('button', { name: 'Resume' }).click()
  await expect.poll(() => lifecycleOf(page)).toBe('running')
  expect(errors).toEqual([])
})

test('Options: defaults, validation errors, Save persists, refresh restores, Cancel discards', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await page.goto('/')
  await openOptions(page)

  const duration = page.getByLabel('Game session time (seconds)')
  const spawn = page.getByLabel('Enemy spawn time (seconds)')
  await expect(duration).toHaveValue('120')
  await expect(spawn).toHaveValue('5')

  // Invalid values produce clear errors and are never saved.
  await duration.fill('300')
  await spawn.fill('0.5')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Session duration must be between 60 and 180 seconds.')).toBeVisible()
  await expect(page.getByText('Enemy spawn interval must be between 1 and 30 seconds.')).toBeVisible()
  expect(await page.evaluate((key) => localStorage.getItem(key), OPTIONS_KEY)).toBeNull()

  await duration.fill('30')
  await expect(page.getByText('Session duration must be between 60 and 180 seconds.')).toBeVisible()

  // Fix and save.
  await duration.fill('90')
  await spawn.fill('3')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()

  // Refresh restores the saved values.
  await page.reload()
  await openOptions(page)
  await expect(page.getByLabel('Game session time (seconds)')).toHaveValue('90')
  await expect(page.getByLabel('Enemy spawn time (seconds)')).toHaveValue('3')

  // Cancel discards the draft.
  await page.getByLabel('Game session time (seconds)').fill('60')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await openOptions(page)
  await expect(page.getByLabel('Game session time (seconds)')).toHaveValue('90')
  expect(errors).toEqual([])
})

test('a match snapshots the options at start; later changes only affect new matches', async ({
  page,
}) => {
  test.slow()
  const errors = collectErrors(page)
  await gotoRunningGame(page) // match A with defaults 120 / 5

  const matchA = await snapshot(page)
  expect(matchA.remainingSeconds).toBeGreaterThan(110)
  expect(matchA.spawnCooldownSeconds).toBeLessThanOrEqual(5)

  // Controlled mechanism: Options are unreachable mid-match, so write
  // the storage directly — the running match must never notice.
  await page.evaluate((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({ version: 1, sessionDurationSeconds: 60, enemySpawnIntervalSeconds: 2 }),
    )
  }, OPTIONS_KEY)
  await page.waitForTimeout(600)
  const stillA = await snapshot(page)
  expect(stillA.remainingSeconds).toBeGreaterThan(105) // still on the 120 s clock
  expect(stillA.spawnCooldownSeconds).toBeGreaterThan(2) // still the 5 s interval

  // A new match uses the new values.
  await exitToMenu(page)
  await startGameFromMenu(page)
  const matchB = await snapshot(page)
  expect(matchB.remainingSeconds).toBeLessThanOrEqual(60)
  expect(matchB.remainingSeconds).toBeGreaterThan(50)
  expect(matchB.spawnCooldownSeconds).toBeLessThanOrEqual(2)
  expect(errors).toEqual([])
})

test('abandoning a match never overwrites the last completed result', async ({ page }) => {
  test.slow()
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  // Complete a real match quickly.
  await page.evaluate(() => {
    const api = window.__gameTest!
    for (let i = 0; i < 130; i += 1) {
      for (const enemy of api.snapshot().enemies) api.removeEnemy(enemy.id)
      api.advanceTime(1)
      if (api.snapshot().lifecycle !== 'running') break
    }
  })
  await expect.poll(() => lifecycleOf(page)).toBe('ended')
  const stored = await page.evaluate(() => localStorage.getItem('pirate-battle:last-match-result'))
  expect(stored).not.toBeNull()

  // Start a new match from the end overlay's Main Menu → Play, play a
  // little, then abandon it.
  await page.getByRole('button', { name: 'Main Menu' }).click()
  await startGameFromMenu(page)
  await page.evaluate(() => window.__gameTest!.advanceTime(3))
  await exitToMenu(page)

  const after = await page.evaluate(() => localStorage.getItem('pirate-battle:last-match-result'))
  expect(after).toBe(stored)
  expect(errors).toEqual([])
})

test('keyboard navigation reaches and activates the menu actions', async ({ page }) => {
  await page.goto('/')
  // The app mounts after MSW activates; Tab must wait for the render.
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Options' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible()
})

test('menu and options fit a narrow viewport without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 760 })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  let overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)

  await openOptions(page)
  overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})
