import { useState } from 'react'
import {
  ENEMY_SPAWN_INTERVAL_LIMITS,
  SESSION_DURATION_LIMITS,
  validateEnemySpawnInterval,
  validateSessionDuration,
} from '../../game/config/gameConfig'
import { loadGameOptions, saveGameOptions } from '../../persistence/gameOptionsStorage'

interface OptionsScreenProps {
  onBack: () => void
}

/**
 * Options screen: a local DRAFT of the two exposed settings. Save
 * validates (with the same core validators the simulation uses) and
 * persists; Cancel discards the draft without touching storage.
 * Changes only ever apply to matches started afterwards.
 */
export default function OptionsScreen({ onBack }: OptionsScreenProps) {
  const [draft] = useState(loadGameOptions)
  const [duration, setDuration] = useState(String(draft.sessionDurationSeconds))
  const [spawn, setSpawn] = useState(String(draft.enemySpawnIntervalSeconds))
  const [showErrors, setShowErrors] = useState(false)

  const durationValue = Number(duration)
  const spawnValue = Number(spawn)
  const durationError =
    duration.trim() === '' ? 'Session duration is required.' : validateSessionDuration(durationValue)
  const spawnError =
    spawn.trim() === '' ? 'Enemy spawn interval is required.' : validateEnemySpawnInterval(spawnValue)

  function handleSave(): void {
    if (durationError || spawnError) {
      setShowErrors(true)
      return
    }
    saveGameOptions({
      sessionDurationSeconds: durationValue,
      enemySpawnIntervalSeconds: spawnValue,
    })
    onBack()
  }

  return (
    <div className="menu-screen">
      <div className="pirate-panel options-panel">
        <h1>Options</h1>

        <div className="options-field">
          <label htmlFor="option-session-duration">Game session time (seconds)</label>
          <input
            id="option-session-duration"
            type="number"
            min={SESSION_DURATION_LIMITS.min}
            max={SESSION_DURATION_LIMITS.max}
            step={5}
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
            aria-describedby="option-session-duration-help option-session-duration-error"
            aria-invalid={showErrors && durationError !== null}
          />
          <p className="options-field__help" id="option-session-duration-help">
            Between {SESSION_DURATION_LIMITS.min} and {SESSION_DURATION_LIMITS.max} seconds.
          </p>
          {showErrors && durationError && (
            <p className="options-field__error" id="option-session-duration-error">
              {durationError}
            </p>
          )}
        </div>

        <div className="options-field">
          <label htmlFor="option-spawn-interval">Enemy spawn time (seconds)</label>
          <input
            id="option-spawn-interval"
            type="number"
            min={ENEMY_SPAWN_INTERVAL_LIMITS.min}
            max={ENEMY_SPAWN_INTERVAL_LIMITS.max}
            step={1}
            value={spawn}
            onChange={(event) => setSpawn(event.target.value)}
            aria-describedby="option-spawn-interval-help option-spawn-interval-error"
            aria-invalid={showErrors && spawnError !== null}
          />
          <p className="options-field__help" id="option-spawn-interval-help">
            Between {ENEMY_SPAWN_INTERVAL_LIMITS.min} and {ENEMY_SPAWN_INTERVAL_LIMITS.max} seconds.
          </p>
          {showErrors && spawnError && (
            <p className="options-field__error" id="option-spawn-interval-error">
              {spawnError}
            </p>
          )}
        </div>

        <div className="options-actions">
          <button type="button" className="pirate-button" onClick={handleSave}>
            Save
          </button>
          <button type="button" className="pirate-button pirate-button--secondary" onClick={onBack}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
