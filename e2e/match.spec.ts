import { expect, test, type Page } from '@playwright/test'
import { collectErrors, gotoRunningGame, lifecycleOf, snapshot } from './gameTest'

/**
 * Fast-forwards a real match to its time limit while keeping the idle
 * player alive: every simulated second, spawned enemies are removed via
 * the real API before they can possibly deal damage (a chaser needs
 * ≥2.3 s to reach the player, a shooter ≥1.1 s to land a ball).
 * All simulation rules execute normally.
 */
async function fastForwardSurviving(page: Page, seconds: number): Promise<void> {
  let left = seconds
  while (left > 0) {
    const chunk = Math.min(1, left)
    const lifecycle = await page.evaluate((s) => {
      const api = window.__gameTest!
      for (const enemy of api.snapshot().enemies) api.removeEnemy(enemy.id)
      api.advanceTime(s)
      return api.snapshot().lifecycle
    }, chunk)
    left -= chunk
    if (lifecycle !== 'running') return
  }
}

test('the HUD shows a countdown that decreases with active time', async ({ page }) => {
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  await expect(page.getByText(/^\d+:\d{2}$/)).toBeVisible()
  const first = await snapshot(page)
  expect(first.remainingSeconds).toBeGreaterThan(115)
  await page.waitForTimeout(1500)
  const second = await snapshot(page)
  expect(second.remainingSeconds).toBeLessThan(first.remainingSeconds)
  expect(errors).toEqual([])
})

test('P pauses everything; held keys die with the pause; Resume requires action', async ({
  page,
}) => {
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  await page.keyboard.down('KeyW')
  await expect.poll(async () => (await snapshot(page)).player.y).toBeLessThan(690)
  await page.keyboard.press('KeyP')
  await expect(page.getByText('Paused')).toBeVisible()

  const frozen = await snapshot(page)
  expect(frozen.lifecycle).toBe('paused')
  await page.waitForTimeout(600)
  const stillFrozen = await snapshot(page)
  expect(stillFrozen.remainingSeconds).toBe(frozen.remainingSeconds)
  expect(stillFrozen.player).toEqual(frozen.player)
  expect(stillFrozen.projectiles).toEqual(frozen.projectiles)
  expect(stillFrozen.enemies).toEqual(frozen.enemies)
  expect(stillFrozen.spawnCooldownSeconds).toBe(frozen.spawnCooldownSeconds)

  // Resume via the explicit button; W is STILL physically held but its
  // intent was cleared on pause — the ship must stay put.
  await page.getByRole('button', { name: 'Resume' }).click()
  await expect.poll(() => lifecycleOf(page)).toBe('running')
  await page.waitForTimeout(500)
  const after = await snapshot(page)
  expect(after.player.x).toBe(frozen.player.x)
  expect(after.player.y).toBe(frozen.player.y)

  // A fresh keypress works again.
  await page.keyboard.up('KeyW')
  await page.keyboard.down('KeyW')
  await expect.poll(async () => (await snapshot(page)).player.y).toBeLessThan(frozen.player.y - 10)
  await page.keyboard.up('KeyW')
  expect(errors).toEqual([])
})

test('losing window focus auto-pauses; regaining focus does NOT auto-resume', async ({ page }) => {
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect.poll(() => lifecycleOf(page)).toBe('paused')
  await expect(page.getByText('Paused')).toBeVisible()

  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForTimeout(600)
  expect((await snapshot(page)).lifecycle).toBe('paused') // still paused

  await page.getByRole('button', { name: 'Resume' }).click()
  await expect.poll(() => lifecycleOf(page)).toBe('running')
  expect(errors).toEqual([])
})

test('a real match expires by time, freezes completely, persists its result and restarts clean', async ({
  page,
}) => {
  test.slow()
  const errors = collectErrors(page)
  await gotoRunningGame(page)
  const seedBefore = (await snapshot(page)).seed

  await fastForwardSurviving(page, 125)
  await expect.poll(() => lifecycleOf(page)).toBe('ended')
  const ended = await snapshot(page)
  expect(ended.endReason).toBe('time-expired')
  expect(ended.remainingSeconds).toBe(0)
  await expect(page.getByText('Time is up')).toBeVisible()
  await expect(page.getByText(/Final score: \d+/)).toBeVisible()

  // Total freeze: real keys + time change nothing after the end.
  await page.keyboard.down('KeyW')
  await page.keyboard.down('Space')
  await page.waitForTimeout(500)
  await page.keyboard.up('Space')
  await page.keyboard.up('KeyW')
  const after = await snapshot(page)
  expect(after.player).toEqual(ended.player)
  expect(after.enemies).toEqual(ended.enemies)
  expect(after.projectiles).toEqual(ended.projectiles)
  expect(after.score).toBe(ended.score)
  expect(after.activeElapsedSeconds).toBe(ended.activeElapsedSeconds)

  // The completed result reached localStorage.
  const stored = await page.evaluate(() =>
    localStorage.getItem('pirate-battle:last-match-result'),
  )
  expect(stored).not.toBeNull()
  const parsed = JSON.parse(stored!) as { endReason: string; score: number; completedAt: string }
  expect(parsed.endReason).toBe('time-expired')
  expect(parsed.score).toBe(ended.score)

  // Play Again: a brand-new session (new seed, full reset).
  await page.getByRole('button', { name: 'Play Again' }).click()
  await expect.poll(() => lifecycleOf(page)).toBe('running')
  const fresh = await snapshot(page)
  expect(fresh.remainingSeconds).toBeGreaterThan(115)
  expect(fresh.score).toBe(0)
  expect(fresh.enemies).toHaveLength(0)
  expect(fresh.totalAutomaticSpawns).toBe(0)
  expect(fresh.player.health).toBe(fresh.player.maxHealth)
  expect(fresh.seed).not.toBe(seedBefore)

  // Reload MID-match: the abandoned session never overwrites the stored
  // completed result (the reload lands back on the Main Menu).
  await page.evaluate(() => window.__gameTest!.advanceTime(2))
  await page.reload()
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  const storedAfterReload = await page.evaluate(() =>
    localStorage.getItem('pirate-battle:last-match-result'),
  )
  expect(storedAfterReload).toBe(stored) // byte-identical: nothing overwrote it
  expect(errors).toEqual([])
})

test('death still ends the match and Restart starts a clean new session', async ({ page }) => {
  test.slow()
  const errors = collectErrors(page)
  await gotoRunningGame(page)

  // Four manual chasers at close (but valid) range: death in a few seconds.
  await page.evaluate(() => {
    const api = window.__gameTest!
    api.spawnEnemy('chaser', 440, 700, -Math.PI / 2)
    api.spawnEnemy('chaser', 40, 700, Math.PI / 2)
    api.spawnEnemy('chaser', 240, 500, Math.PI)
    api.spawnEnemy('chaser', 240, 868, 0)
  })
  await expect.poll(() => lifecycleOf(page), { timeout: 20000 }).toBe('ended')
  const dead = await snapshot(page)
  expect(dead.endReason).toBe('player-death')
  expect(dead.player.health).toBe(0)
  await expect(page.getByText('Your ship was destroyed')).toBeVisible()

  await page.getByRole('button', { name: 'Play Again' }).click()
  await expect.poll(() => lifecycleOf(page)).toBe('running')
  const fresh = await snapshot(page)
  expect(fresh.player.health).toBe(fresh.player.maxHealth)
  expect(fresh.score).toBe(0)
  expect(fresh.enemies).toHaveLength(0)
  expect(fresh.endReason).toBeNull()
  expect(errors).toEqual([])
})
