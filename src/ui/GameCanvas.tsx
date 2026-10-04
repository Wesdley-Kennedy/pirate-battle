import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import iconFireFrontUrl from '../../assets/png/default/ui/controls/icon_fire_front.png'
import iconFireLeftUrl from '../../assets/png/default/ui/controls/icon_fire_left.png'
import iconFireRightUrl from '../../assets/png/default/ui/controls/icon_fire_right.png'
import iconForwardUrl from '../../assets/png/default/ui/controls/icon_forward.png'
import iconPauseSmallUrl from '../../assets/png/default/ui/controls/icon_pause.png'
import iconTurnLeftUrl from '../../assets/png/default/ui/controls/icon_turn_left.png'
import iconTurnRightUrl from '../../assets/png/default/ui/controls/icon_turn_right.png'
import { buildMatchRecord } from '../api/matchRecord'
import { useRegisterMatchMutation } from '../api/queries'
import type { MatchRecord } from '../api/types'
import { createHudStore, type HudStore } from '../bridge/hudStore'
import { buildGameConfigFromOptions } from '../game/config/gameConfig'
import type { MovementIntent } from '../game/input/movementIntent'
import type { WeaponIntent } from '../game/input/weaponIntent'
import {
  createPixiStage,
  type PixiStageController,
  type StageState,
} from '../game/render/pixiStage'
import { loadGameOptions } from '../persistence/gameOptionsStorage'
import { loadLastMatchResult } from '../persistence/lastMatchStorage'
import { formatRemainingTime } from './format'
import MatchHud from './MatchHud'
import TouchControls from './TouchControls'

/** Touch controls render only where touch input actually exists. */
function detectTouchDevice(): boolean {
  return navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches
}

interface GameCanvasProps {
  /** Leaving mid-match is ABANDONMENT: teardown, no result persisted. */
  onExitToMenu: () => void
}

const CONTROLS: { icon: string; keys: string; action: string }[] = [
  { icon: iconForwardUrl, keys: 'W / ↑', action: 'Move forward' },
  { icon: iconTurnLeftUrl, keys: 'A / ←', action: 'Turn left' },
  { icon: iconTurnRightUrl, keys: 'D / →', action: 'Turn right' },
  { icon: iconFireFrontUrl, keys: 'Space', action: 'Front cannon' },
  { icon: iconFireLeftUrl, keys: 'Q', action: 'Left broadside' },
  { icon: iconFireRightUrl, keys: 'E', action: 'Right broadside' },
  { icon: iconPauseSmallUrl, keys: 'P', action: 'Pause / resume' },
]

export default function GameCanvas({ onExitToMenu }: GameCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<PixiStageController | null>(null)
  const [store] = useState<HudStore>(createHudStore)
  const [stageState, setStageState] = useState<StageState>('loading')
  const [touchDevice] = useState(detectTouchDevice)
  // Stable identities: TouchControls' cleanup effect depends on these.
  const handleTouchMovement = useCallback(
    (intent: MovementIntent) => controllerRef.current?.setTouchMovement(intent),
    [],
  )
  const handleTouchWeapons = useCallback(
    (intent: WeaponIntent) => controllerRef.current?.setTouchWeapons(intent),
    [],
  )
  // ---- Result registration (Block: ranking/history integration) ----
  // A completed match is registered exactly once; the deterministic
  // matchId plus the server-side idempotency make any re-send recover
  // the existing record. Gameplay NEVER waits for the network: the
  // mutation is fire-and-forget and only the status line observes it.
  const registerMutation = useRegisterMatchMutation()
  const { mutate: registerRecord, reset: resetRegistration } = registerMutation
  const [record, setRecord] = useState<MatchRecord | null>(null)
  const registeredIdRef = useRef<string | null>(null)
  // Renders only on DISCRETE changes (whole second, HP, score, lifecycle)
  // — never per frame.
  const hud = useSyncExternalStore(store.subscribe, store.getSnapshot)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // The persisted options are read when each match starts (Play and
    // Restart), snapshotted into the session, and never re-read mid-match.
    const controller = createPixiStage(host, setStageState, store, () =>
      buildGameConfigFromOptions(loadGameOptions()),
    )
    controllerRef.current = controller
    return () => {
      controllerRef.current = null
      controller.destroy()
    }
  }, [store])

  const lifecycle = hud?.lifecycle
  useEffect(() => {
    if (lifecycle === 'ended') {
      // The stage persisted the completed result synchronously in the
      // same ticker callback that flipped the lifecycle, so it is
      // already readable here.
      const stored = loadLastMatchResult()
      if (!stored) return
      const next = buildMatchRecord(stored)
      if (registeredIdRef.current === next.matchId) return
      registeredIdRef.current = next.matchId
      setRecord(next)
      registerRecord(next)
    } else if (lifecycle === 'running' && registeredIdRef.current !== null) {
      // Play Again: a fresh match clears the previous registration UI.
      registeredIdRef.current = null
      setRecord(null)
      resetRegistration()
    }
  }, [lifecycle, registerRecord, resetRegistration])

  return (
    <>
      {touchDevice && (
        // CSS shows this only while the viewport is portrait; gameplay is
        // designed for landscape but nothing is blocked either way.
        <p className="rotate-hint">Rotate your device for the best experience.</p>
      )}
      <div className="game-stage">
        <div className="game-stage__canvas-host" ref={hostRef} />
        {stageState === 'loading' && (
          <p className="game-stage__overlay" role="status">
            Loading assets…
          </p>
        )}
        {stageState === 'error' && (
          <div className="game-stage__overlay" role="alert">
            <p>Failed to load game assets</p>
            <button type="button" className="pirate-button" onClick={() => controllerRef.current?.retry()}>
              Retry
            </button>
          </div>
        )}
        {stageState === 'ready' && hud && (
          <MatchHud hud={hud} onPause={() => controllerRef.current?.pauseMatch()} />
        )}
        {touchDevice && stageState === 'ready' && hud?.lifecycle === 'running' && (
          <TouchControls
            onMovementChange={handleTouchMovement}
            onWeaponChange={handleTouchWeapons}
          />
        )}
        {hud?.lifecycle === 'paused' && (
          <div className="game-stage__overlay game-stage__overlay--veil">
            <div className="overlay-panel">
              <h2 className="overlay-panel__title">Paused</h2>
              <p className="overlay-panel__hint">The seas are holding their breath…</p>
              <button
                type="button"
                className="pirate-button"
                onClick={() => controllerRef.current?.resumeMatch()}
              >
                Resume
              </button>
              <button type="button" className="pirate-button pirate-button--secondary" onClick={onExitToMenu}>
                Main Menu
              </button>
            </div>
          </div>
        )}
        {hud?.lifecycle === 'ended' && (
          <div className="game-stage__overlay game-stage__overlay--veil">
            <div className="overlay-panel">
              <h2 className="overlay-panel__title">
                {hud.endReason === 'player-death' ? 'Your ship was destroyed' : 'Time is up'}
              </h2>
              <p className="overlay-panel__hint">
                {hud.endReason === 'player-death'
                  ? 'The pirates got the better of you this time.'
                  : 'The battle is over — the fleet stands down.'}
              </p>
              <p className="overlay-panel__score">Final score: {hud.score}</p>
              {record && (
                <p className="overlay-panel__detail">
                  Time played: {formatRemainingTime(record.durationPlayedSeconds)}
                </p>
              )}
              {record && (
                <p className="overlay-panel__registration" role="status">
                  {registerMutation.isPending && 'Saving your result…'}
                  {registerMutation.isSuccess && 'Result saved to the leaderboard.'}
                  {registerMutation.isError && 'Registration failed.'}
                </p>
              )}
              {record && registerMutation.isError && (
                <button
                  type="button"
                  className="overlay-panel__retry"
                  onClick={() => registerRecord(record)}
                >
                  Retry
                </button>
              )}
              <button
                type="button"
                className="pirate-button"
                onClick={() => controllerRef.current?.restartMatch()}
              >
                Play Again
              </button>
              <button type="button" className="pirate-button pirate-button--secondary" onClick={onExitToMenu}>
                Main Menu
              </button>
            </div>
          </div>
        )}
      </div>
      <details className="controls-legend" open>
        <summary>Controls</summary>
        <ul>
          {CONTROLS.map((entry) => (
            <li key={entry.action}>
              <img src={entry.icon} alt="" />
              <kbd>{entry.keys}</kbd>
              <span>{entry.action}</span>
            </li>
          ))}
        </ul>
      </details>
    </>
  )
}
