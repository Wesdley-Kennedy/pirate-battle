import {
  DEFAULT_GAME_CONFIG,
  validateEnemySpawnInterval,
  validateSessionDuration,
  type GameplayOptions,
} from '../game/config/gameConfig'

/**
 * Local persistence for the two player-facing options. Core never
 * touches browser storage; this adapter guards every access and falls
 * back FIELD BY FIELD to the defaults when data is missing, corrupted
 * or out of the documented limits — bad storage can never break the app
 * or smuggle values past the validators.
 */
const STORAGE_KEY = 'pirate-battle:options'
const STORAGE_VERSION = 1

interface StoredOptionsV1 extends GameplayOptions {
  version: typeof STORAGE_VERSION
}

export function defaultGameOptions(): GameplayOptions {
  return {
    sessionDurationSeconds: DEFAULT_GAME_CONFIG.match.sessionDurationSeconds,
    enemySpawnIntervalSeconds: DEFAULT_GAME_CONFIG.match.enemySpawnIntervalSeconds,
  }
}

export function loadGameOptions(): GameplayOptions {
  const defaults = defaultGameOptions()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return defaults
    const candidate = parsed as Partial<StoredOptionsV1>
    if (candidate.version !== STORAGE_VERSION) return defaults

    const duration = candidate.sessionDurationSeconds
    const spawn = candidate.enemySpawnIntervalSeconds
    return {
      sessionDurationSeconds:
        typeof duration === 'number' && validateSessionDuration(duration) === null
          ? duration
          : defaults.sessionDurationSeconds,
      enemySpawnIntervalSeconds:
        typeof spawn === 'number' && validateEnemySpawnInterval(spawn) === null
          ? spawn
          : defaults.enemySpawnIntervalSeconds,
    }
  } catch {
    return defaults
  }
}

export function saveGameOptions(options: GameplayOptions): void {
  try {
    const stored: StoredOptionsV1 = { version: STORAGE_VERSION, ...options }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // Storage unavailable: the session still uses the chosen values.
  }
}

export const GAME_OPTIONS_STORAGE_KEY = STORAGE_KEY
