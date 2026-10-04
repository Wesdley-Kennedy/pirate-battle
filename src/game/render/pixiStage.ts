import { Application, type Ticker } from 'pixi.js'
import type { HudStore } from '../../bridge/hudStore'
import { saveLastMatchResult } from '../../persistence/lastMatchStorage'
import { installGameTestApi } from '../../test/gameTestApi'
import type { GameConfig } from '../config/gameConfig'
import type { Clock } from '../core/clock'
import { GameSession } from '../core/gameSession'
import { attachKeyboardInput, type KeyboardInputHandle } from '../input/keyboardInput'
import { createEmptyMovementIntent, type MovementIntent } from '../input/movementIntent'
import { createEmptyWeaponIntent, type WeaponIntent } from '../input/weaponIntent'
import { buildMatchScene, type MatchScene } from './matchScene'
import { loadGameAssets, type GameAssets } from './gameAssets'

export type StageState = 'loading' | 'ready' | 'error'

export interface PixiStageController {
  retry(): void
  pauseMatch(): void
  resumeMatch(): void
  /** Allowed only after the match ended; creates a brand-new session. */
  restartMatch(seed?: number): void
  /** Touch adapter input. Merged (logical OR) with the keyboard state —
   * the simulation always receives a single combined intent. */
  setTouchMovement(intent: MovementIntent): void
  setTouchWeapons(intent: WeaponIntent): void
  destroy(): void
}

/**
 * Real clock with a dev/test fast-forward offset. Production never calls
 * `advance`; the test API uses it to run real matches quickly while every
 * simulation rule (fixed steps, clamp, spawns, AI) executes normally.
 */
function createInstrumentedClock(): Clock & { advance(seconds: number): void } {
  let offset = 0
  return {
    now: () => performance.now() / 1000 + offset,
    advance(seconds: number) {
      offset += seconds
    },
  }
}

/**
 * Owns one React mount's Pixi Application and the lifecycle of match
 * sessions on it: async init, asset loading, session start/restart,
 * manual + automatic pause, result persistence and full teardown.
 * Safe under StrictMode double-mount: if `destroy()` runs while `init()`
 * is still pending, the orphan Application is destroyed instead of
 * attached. Time has a single authority: the Pixi ticker only PROVOKES
 * `session.tick()`; deltas come from the session's Clock (PHASE 3).
 */
export function createPixiStage(
  container: HTMLElement,
  onStateChange: (state: StageState) => void,
  hudStore: HudStore,
  /** Called at every match start (Play/Restart): the returned config is
   * snapshotted into the new session and never re-read mid-match. */
  getMatchConfig: () => GameConfig,
): PixiStageController {
  let destroyed = false
  let working = false
  let app: Application | null = null
  let assets: GameAssets | null = null
  let resizeObserver: ResizeObserver | null = null
  let scene: MatchScene | null = null
  let session: GameSession | null = null
  let keyboard: KeyboardInputHandle | null = null
  let tickerCallback: ((ticker: Ticker) => void) | null = null
  let uninstallTestApi: (() => void) | null = null
  let clock: ReturnType<typeof createInstrumentedClock> | null = null
  let resultSaved = false
  // Keyboard and touch are independent adapters; the session only ever
  // sees their merged (OR) state, so holding W and a touch button at
  // once — or releasing one while the other stays held — just works.
  let keyboardMovement = createEmptyMovementIntent()
  let keyboardWeapons = createEmptyWeaponIntent()
  let touchMovement = createEmptyMovementIntent()
  let touchWeapons = createEmptyWeaponIntent()

  function pushMergedIntents(): void {
    if (!session) return
    session.setPlayerIntent({
      forward: keyboardMovement.forward || touchMovement.forward,
      turnLeft: keyboardMovement.turnLeft || touchMovement.turnLeft,
      turnRight: keyboardMovement.turnRight || touchMovement.turnRight,
    })
    session.setWeaponIntent({
      fireFront: keyboardWeapons.fireFront || touchWeapons.fireFront,
      fireLeft: keyboardWeapons.fireLeft || touchWeapons.fireLeft,
      fireRight: keyboardWeapons.fireRight || touchWeapons.fireRight,
    })
  }

  function clearTouchIntents(): void {
    touchMovement = createEmptyMovementIntent()
    touchWeapons = createEmptyWeaponIntent()
  }

  function syncSize(): void {
    if (!app) return
    const width = Math.max(1, container.clientWidth)
    const height = Math.max(1, container.clientHeight)
    app.renderer.resize(width, height)
    scene?.layout(width, height)
  }

  /**
   * Pauses the running match (manual key/button, window blur or hidden
   * tab all route here). Resuming ALWAYS requires an explicit player
   * action — regaining focus never resumes by itself.
   */
  function doPause(): void {
    if (!session || session.state !== 'running') return
    session.pause()
    // Touch state is forgotten BEFORE the keyboard emits its empty
    // intents, so a held touch button can never leak back into the
    // paused session through the merged push. Resuming requires fresh
    // presses on both adapters, exactly like the keyboard contract.
    clearTouchIntents()
    keyboard?.clearPressed()
  }

  function doResume(): void {
    if (!session || session.state !== 'paused') return
    session.resume()
  }

  function handleWindowBlur(): void {
    doPause()
  }

  function handleVisibilityChange(): void {
    if (document.hidden) doPause()
  }

  /** P toggles pause/resume (resume via key counts as explicit action). */
  function handleControlKeys(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.code !== 'KeyP' || event.repeat) return
    if (!session) return
    if (session.state === 'running') doPause()
    else if (session.state === 'paused') doResume()
  }

  async function initApp(): Promise<boolean> {
    const nextApp = new Application()
    try {
      await nextApp.init({
        preference: 'webgl',
        background: '#1d4e6b',
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        antialias: true,
        width: Math.max(1, container.clientWidth),
        height: Math.max(1, container.clientHeight),
      })
    } catch {
      // Init failed before the app owned any DOM/GL resources we track;
      // dropping the reference is safer than destroying a half-built app.
      if (!destroyed) onStateChange('error')
      return false
    }
    if (destroyed) {
      nextApp.destroy({ removeView: true }, { children: true })
      return false
    }
    app = nextApp
    container.appendChild(app.canvas)
    resizeObserver = new ResizeObserver(syncSize)
    resizeObserver.observe(container)
    syncSize()

    window.addEventListener('blur', handleWindowBlur)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('keydown', handleControlKeys)
    return true
  }

  /**
   * Persists the completed result exactly once. MUST run before the hud
   * store can observe the 'ended' state: React reacts to that state by
   * reading the stored result (abandoned sessions are destroyed without
   * ending and therefore never pass through here).
   */
  function persistResultOnce(): void {
    if (!session || resultSaved) return
    if (session.state === 'ended' && session.matchResult) {
      resultSaved = true
      saveLastMatchResult(session.matchResult)
    }
  }

  /** Fast-forwards a RUNNING match through real simulation (dev/test). */
  function advanceTime(seconds: number): void {
    if (!session || !clock) return
    let left = seconds
    while (left > 0 && session.state === 'running') {
      const chunk = Math.min(0.24, left) // below the 0.25 s frame clamp
      clock.advance(chunk)
      left -= chunk
      session.tick()
    }
    persistResultOnce()
    if (scene) scene.update()
    if (session) hudStore.update(session)
  }

  /** Creates and wires a fresh match session (initial start and restarts). */
  function startMatch(seed?: number): void {
    if (!app || !assets || destroyed) return
    clock = createInstrumentedClock()
    const newSession = new GameSession({ config: getMatchConfig(), clock, seed })
    session = newSession
    resultSaved = false
    keyboardMovement = createEmptyMovementIntent()
    keyboardWeapons = createEmptyWeaponIntent()
    clearTouchIntents()
    scene = buildMatchScene(app.stage, assets, newSession)
    syncSize()
    uninstallTestApi = installGameTestApi(newSession, { advanceTime, restart: restartMatch })
    newSession.start()
    hudStore.update(newSession)

    keyboard = attachKeyboardInput({
      onMovementChange: (intent) => {
        keyboardMovement = intent
        pushMergedIntents()
      },
      onWeaponChange: (intent) => {
        keyboardWeapons = intent
        pushMergedIntents()
      },
    })

    tickerCallback = () => {
      newSession.tick()
      persistResultOnce() // before the hud store may announce 'ended'
      scene?.update()
      hudStore.update(newSession)
    }
    app.ticker.add(tickerCallback)
  }

  /** Tears down everything owned by the current match (app/assets stay). */
  function teardownMatch(): void {
    keyboard?.destroy()
    keyboard = null
    uninstallTestApi?.()
    uninstallTestApi = null
    if (app && tickerCallback) app.ticker.remove(tickerCallback)
    tickerCallback = null
    session?.destroy()
    session = null
    scene?.destroy()
    scene = null
    clock = null
  }

  async function start(): Promise<void> {
    if (working || destroyed) return
    working = true
    onStateChange('loading')
    try {
      if (!app) {
        const initialized = await initApp()
        if (!initialized || destroyed) return
      }
      if (session) return
      try {
        assets = await loadGameAssets()
      } catch {
        if (!destroyed) onStateChange('error')
        return
      }
      if (destroyed || !app) return
      startMatch()
      onStateChange('ready')
    } finally {
      working = false
    }
  }

  function restartMatch(seed?: number): void {
    if (destroyed || !app || !assets) return
    if (session && session.state !== 'ended') return // restart only after end
    teardownMatch()
    startMatch(seed)
  }

  void start()

  return {
    retry() {
      void start()
    },
    pauseMatch: doPause,
    resumeMatch: doResume,
    restartMatch,
    setTouchMovement(intent: MovementIntent) {
      // Touch input only matters while running; in any other state the
      // stored flags are dropped so nothing stale survives a pause/end.
      if (!session || session.state !== 'running') {
        clearTouchIntents()
        return
      }
      touchMovement = { ...intent }
      pushMergedIntents()
    },
    setTouchWeapons(intent: WeaponIntent) {
      if (!session || session.state !== 'running') {
        clearTouchIntents()
        return
      }
      touchWeapons = { ...intent }
      pushMergedIntents()
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      window.removeEventListener('blur', handleWindowBlur)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('keydown', handleControlKeys)
      teardownMatch()
      hudStore.reset()
      resizeObserver?.disconnect()
      resizeObserver = null
      if (app) {
        // Destroys renderer, canvas (removeView) and scene graph children.
        // Shared textures stay in the Assets cache for the next mount.
        app.destroy({ removeView: true }, { children: true })
        app = null
      }
    },
  }
}
