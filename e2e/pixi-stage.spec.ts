import { expect, test, type Locator, type Page } from '@playwright/test'

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  return errors
}

function stageCanvas(page: Page): Locator {
  return page.locator('.game-stage canvas')
}

/** The app now boots into the Main Menu: Play enters the game screen. */
async function openGame(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
}

async function expectStageReady(page: Page): Promise<void> {
  // Generous timeouts: asset loading can be slow under full-suite load.
  await expect(stageCanvas(page)).toHaveCount(1, { timeout: 15000 })
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 15000 })
  await expect(page.getByRole('alert')).toHaveCount(0)
}

test('renders exactly one Pixi canvas under StrictMode', async ({ page }) => {
  const errors = collectErrors(page)
  await openGame(page)
  await expectStageReady(page)
  expect(errors).toEqual([])
})

test('shows the loading state while assets are in flight', async ({ page }) => {
  await page.route('**/ship_1.png', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600))
    await route.continue()
  })
  await openGame(page)
  await expect(page.getByRole('status')).toBeVisible()
  await expectStageReady(page)
})

test('keeps a single working canvas across repeated resizes', async ({ page }) => {
  const errors = collectErrors(page)
  await openGame(page)
  await expectStageReady(page)

  for (const viewport of [
    { width: 1200, height: 700 },
    { width: 480, height: 800 },
    { width: 1024, height: 600 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(stageCanvas(page)).toHaveCount(1)
    await expect(stageCanvas(page)).toBeVisible()
  }

  await page.setViewportSize({ width: 480, height: 800 })
  await expect
    .poll(async () => {
      const box = await stageCanvas(page).boundingBox()
      return box?.width ?? 0
    })
    .toBeLessThanOrEqual(480)
  expect(errors).toEqual([])
})

test('survives reload (back to the menu, then straight into a fresh game)', async ({ page }) => {
  await openGame(page)
  await expectStageReady(page)
  await page.reload()
  // Reload lands on the Main Menu (screen state is not persisted).
  await expect(stageCanvas(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expectStageReady(page)
})

test('unmount removes the canvas and remount recreates exactly one', async ({ page }) => {
  const errors = collectErrors(page)
  await openGame(page)
  await expectStageReady(page)

  // Leave through the real flow: pause → Main Menu (abandonment).
  await page.keyboard.press('KeyP')
  await page.getByRole('button', { name: 'Main Menu' }).click()
  await expect(stageCanvas(page)).toHaveCount(0)

  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expectStageReady(page)
  expect(errors).toEqual([])
})

test.describe('without the mock service worker', () => {
  // page.route cannot intercept requests that flow through a service
  // worker (MSW), so the asset-failure simulation blocks SW registration
  // for this context; the app is required to boot without one.
  test.use({ serviceWorkers: 'block' })

  test('failed asset load shows the error state and retry recovers', async ({ page }) => {
    await page.route('**/ship_1.png', (route) => route.abort())
    await openGame(page)

    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible({ timeout: 15000 })
    await expect(alert).toContainText('Failed to load game assets')

    await page.unroute('**/ship_1.png')
    await alert.getByRole('button', { name: 'Retry' }).click()
    await expectStageReady(page)
  })
})

test.describe('high device pixel ratio', () => {
  test.use({ deviceScaleFactor: 2, viewport: { width: 1280, height: 720 } })

  test('canvas backing store matches devicePixelRatio', async ({ page }) => {
    await openGame(page)
    await expectStageReady(page)

    const metrics = await stageCanvas(page).evaluate((element) => {
      const canvas = element as HTMLCanvasElement
      return {
        backingWidth: canvas.width,
        cssWidth: canvas.getBoundingClientRect().width,
        devicePixelRatio: window.devicePixelRatio,
      }
    })
    expect(metrics.devicePixelRatio).toBe(2)
    expect(Math.abs(metrics.backingWidth - metrics.cssWidth * 2)).toBeLessThanOrEqual(2)
  })
})
