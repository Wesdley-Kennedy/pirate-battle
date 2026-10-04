import { expect, test, type Page } from '@playwright/test'
import { collectErrors, gotoRunningGame, lifecycleOf } from './gameTest'

/**
 * Ranking + Match History happy path through the real stack:
 * Axios → MSW handlers → localStorage-backed mock data, consumed with
 * TanStack Query. Scenarios (success/empty/error) are selected exactly
 * like a user would — or written straight to storage when a test needs
 * to change them without triggering an invalidation.
 */
const SCENARIO_KEY = 'pirate-battle:mock-scenario'

/** Completes the running match by real simulation fast-forward. */
async function finishMatch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = window.__gameTest!
    for (let i = 0; i < 190; i += 1) {
      for (const enemy of api.snapshot().enemies) api.removeEnemy(enemy.id)
      api.advanceTime(1)
      if (api.snapshot().lifecycle !== 'running') break
    }
  })
  await expect.poll(() => lifecycleOf(page)).toBe('ended')
}

test('ranking shows the fixture leaderboard with deterministic order and pagination', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await page.goto('/')

  const rows = page.locator('.board-list li')
  await expect(rows.first()).toContainText('Scurvy Sam')
  await expect(rows.first()).toContainText('#1')
  await expect(rows.first()).toContainText('11 pts')
  // Best-per-player: Scurvy Sam's weaker 7-point match never shows.
  await expect(page.getByText('7 pts')).toHaveCount(0)
  // Deterministic tiebreak at 8 pts: earlier completion ranks first.
  await expect(rows.nth(2)).toContainText('Salty Jack')
  await expect(rows.nth(3)).toContainText('Stormy Finn')

  // Pagination: 7 fixture captains → 2 pages of 5.
  await expect(page.getByText('Page 1 of 2')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled()
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByText('Page 2 of 2')).toBeVisible()
  await expect(page.getByText('Powder Peg')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled()
  await page.getByRole('button', { name: 'Previous' }).click()
  await expect(page.getByText('Page 1 of 2')).toBeVisible()
  expect(errors).toEqual([])
})

test('empty and error scenarios render their states; Retry recovers after the API heals', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByText('Scurvy Sam')).toBeVisible()

  const scenarioSelect = page.getByLabel('Network (demo)')
  await scenarioSelect.selectOption('empty')
  await expect(page.getByText(/No matches recorded for these game options yet/)).toBeVisible()

  await scenarioSelect.selectOption('error')
  await expect(page.getByText('Could not load the ranking.')).toBeVisible()

  // Heal the API behind the scenes (no invalidation): the user's Retry
  // button itself must bring the data back.
  await page.evaluate((key) => localStorage.setItem(key, 'success'), SCENARIO_KEY)
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByText('Scurvy Sam')).toBeVisible()

  // Reset restores the initial fixture state.
  await page.getByRole('button', { name: 'Reset mock data' }).click()
  await expect(page.getByText('Page 1 of 2')).toBeVisible()
})

test('a completed match registers once, feeds both tabs and survives a refresh', async ({
  page,
}) => {
  test.slow()
  const errors = collectErrors(page)
  await gotoRunningGame(page)
  await finishMatch(page)

  // Result screen: score, time played and the registration status.
  await expect(page.getByText('Final score: 0')).toBeVisible()
  await expect(page.getByText('Time played: 2:00')).toBeVisible()
  await expect(page.getByText('Result saved to the leaderboard.')).toBeVisible()

  await page.getByRole('button', { name: 'Main Menu' }).click()

  // History: exactly one record for the local player.
  await page.getByRole('button', { name: 'Match History' }).click()
  const historyRows = page.locator('.board-list li')
  await expect(historyRows).toHaveCount(1)
  await expect(historyRows.first()).toContainText('Time expired')
  await expect(historyRows.first()).toContainText('2:00 played')
  await expect(historyRows.first()).toContainText('0 pts')
  await expect(page.getByText('Page 1 of 1')).toBeVisible()

  // Ranking: "Player" joins the fixture leaderboard (0 pts → last page).
  await page.getByRole('button', { name: 'Ranking' }).click()
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByText('Player', { exact: true })).toBeVisible()

  // Refresh: confirmed records persist in the mock data layer.
  await page.reload()
  await page.getByRole('button', { name: 'Match History' }).click()
  await expect(page.locator('.board-list li')).toHaveCount(1)
  await expect(page.locator('.board-list li').first()).toContainText('0 pts')
  expect(errors).toEqual([])
})

test('failed registration offers Retry without blocking anything; retrying saves exactly once', async ({
  page,
}) => {
  test.slow()
  await gotoRunningGame(page)
  // Break the API before the match completes (direct write: the menu
  // selector is not reachable mid-match).
  await page.evaluate((key) => localStorage.setItem(key, 'error'), SCENARIO_KEY)
  await finishMatch(page)

  await expect(page.getByText('Registration failed.')).toBeVisible()
  // Gameplay is never hostage to the network: both actions stay live.
  await expect(page.getByRole('button', { name: 'Play Again' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Main Menu' })).toBeEnabled()

  // Heal the API and retry from the Result screen.
  await page.evaluate((key) => localStorage.setItem(key, 'success'), SCENARIO_KEY)
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByText('Result saved to the leaderboard.')).toBeVisible()

  // Exactly one record made it through (deterministic matchId).
  await page.getByRole('button', { name: 'Main Menu' }).click()
  await page.getByRole('button', { name: 'Match History' }).click()
  await expect(page.locator('.board-list li')).toHaveCount(1)
})
