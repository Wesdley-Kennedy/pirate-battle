/**
 * Centralized, strongly typed gameplay configuration.
 *
 * All balance values live here so systems never hard-code magic numbers.
 * Each match captures an immutable snapshot via {@link snapshotGameConfig};
 * later edits to the source object never affect a match in progress.
 *
 * Units: seconds for time, pixels/second for linear speed,
 * radians/second for rotation speed.
 */

export interface GameConfig {
  arena: {
    /** Logical arena size in simulation pixels; rendering scales to fit. */
    width: number
    height: number
  }
  match: {
    /** Active play time of one match. Challenge rule: 60–180 seconds. */
    sessionDurationSeconds: number
    /** Interval between enemy spawns. See ENEMY_SPAWN_INTERVAL_LIMITS. */
    enemySpawnIntervalSeconds: number
    /** Relative spawn weights; both types must appear in a standard match. */
    enemyDistribution: {
      chaserWeight: number
      shooterWeight: number
    }
  }
  player: {
    maxHealth: number
    moveSpeed: number
    rotationSpeed: number
    /**
     * Collision circle radius. The ship sprite is 66×113 px; a 30 px circle
     * covers the hull width and forgives bow/stern overlap — stable and
     * rotation-invariant, which matters more than pixel-perfection here.
     */
    collisionRadius: number
  }
  enemies: {
    chaser: {
      maxHealth: number
      moveSpeed: number
      rotationSpeed: number
      /** Damage dealt to the player when the Chaser self-destructs on impact. */
      collisionDamage: number
      /** Collision circle radius; enemy hulls share the 66×113 px ship art. */
      collisionRadius: number
    }
    shooter: {
      maxHealth: number
      moveSpeed: number
      rotationSpeed: number
      /** Distance at which the Shooter starts firing at the player. */
      attackRange: number
      fireCooldownSeconds: number
      /** Collision circle radius; enemy hulls share the 66×113 px ship art. */
      collisionRadius: number
    }
  }
  projectiles: {
    frontDamage: number
    broadsideDamage: number
    enemyDamage: number
    speed: number
    /** Projectiles expire after this time; range emerges as speed × lifetime. */
    lifetimeSeconds: number
    /** Collision circle radius (cannon ball sprite is 10×10 px). */
    collisionRadius: number
    frontFireCooldownSeconds: number
    broadsideFireCooldownSeconds: number
  }
}

type DeepReadonly<T> = { readonly [K in keyof T]: DeepReadonly<T[K]> }

/** Immutable (deep-frozen, deep-cloned) view of a GameConfig. */
export type GameConfigSnapshot = DeepReadonly<GameConfig>

/** Challenge requirement: session duration must stay within these bounds. */
export const SESSION_DURATION_LIMITS = { min: 60, max: 180 } as const

/**
 * Documented bounds for the enemy spawn interval (Options screen).
 * Minimum 1s prevents an unplayable enemy flood; maximum 30s guarantees
 * several spawns (and therefore both enemy types) even in a 60s match.
 */
export const ENEMY_SPAWN_INTERVAL_LIMITS = { min: 1, max: 30 } as const

export interface ConfigValidationError {
  field: 'sessionDurationSeconds' | 'enemySpawnIntervalSeconds' | 'enemyDistribution'
  message: string
}

/** Reusable by the future Options screen. Returns null when valid. */
export function validateSessionDuration(value: number): string | null {
  if (!Number.isFinite(value)) return 'Session duration must be a number.'
  if (value < SESSION_DURATION_LIMITS.min || value > SESSION_DURATION_LIMITS.max) {
    return `Session duration must be between ${SESSION_DURATION_LIMITS.min} and ${SESSION_DURATION_LIMITS.max} seconds.`
  }
  return null
}

/** Reusable by the future Options screen. Returns null when valid. */
export function validateEnemySpawnInterval(value: number): string | null {
  if (!Number.isFinite(value)) return 'Enemy spawn interval must be a number.'
  if (value < ENEMY_SPAWN_INTERVAL_LIMITS.min || value > ENEMY_SPAWN_INTERVAL_LIMITS.max) {
    return `Enemy spawn interval must be between ${ENEMY_SPAWN_INTERVAL_LIMITS.min} and ${ENEMY_SPAWN_INTERVAL_LIMITS.max} seconds.`
  }
  return null
}

export function validateGameConfig(config: GameConfig): ConfigValidationError[] {
  const errors: ConfigValidationError[] = []

  const durationError = validateSessionDuration(config.match.sessionDurationSeconds)
  if (durationError) errors.push({ field: 'sessionDurationSeconds', message: durationError })

  const spawnError = validateEnemySpawnInterval(config.match.enemySpawnIntervalSeconds)
  if (spawnError) errors.push({ field: 'enemySpawnIntervalSeconds', message: spawnError })

  const { chaserWeight, shooterWeight } = config.match.enemyDistribution
  if (
    !Number.isFinite(chaserWeight) ||
    !Number.isFinite(shooterWeight) ||
    chaserWeight < 0 ||
    shooterWeight < 0 ||
    chaserWeight + shooterWeight <= 0
  ) {
    errors.push({
      field: 'enemyDistribution',
      message: 'Enemy distribution weights must be non-negative and sum to more than zero.',
    })
  }

  return errors
}

/**
 * Validates and captures an immutable snapshot of the configuration.
 * The snapshot is a deep clone, deep-frozen: neither later mutations of the
 * source nor attempted mutations of the snapshot can affect a running match.
 * @throws Error when the configuration is invalid.
 */
export function snapshotGameConfig(config: GameConfig): GameConfigSnapshot {
  const errors = validateGameConfig(config)
  if (errors.length > 0) {
    throw new Error(`Invalid game config: ${errors.map((e) => e.message).join(' ')}`)
  }
  const copy = structuredClone(config)
  deepFreeze(copy)
  return copy
}

function deepFreeze(value: object): void {
  for (const child of Object.values(value)) {
    if (typeof child === 'object' && child !== null) deepFreeze(child)
  }
  Object.freeze(value)
}

/** The two player-facing options exposed on the Options screen. */
export interface GameplayOptions {
  sessionDurationSeconds: number
  enemySpawnIntervalSeconds: number
}

/**
 * Builds a full match config from the persisted player options: the
 * defaults are cloned and ONLY the two exposed fields are applied, so
 * stored data can never override internal balance values (health,
 * damage, weights, speeds, ...).
 */
export function buildGameConfigFromOptions(options: GameplayOptions): GameConfig {
  const config = structuredClone(DEFAULT_GAME_CONFIG)
  config.match.sessionDurationSeconds = options.sessionDurationSeconds
  config.match.enemySpawnIntervalSeconds = options.enemySpawnIntervalSeconds
  return config
}

/**
 * Default balance values. Reasonable starting points, not final balancing —
 * tuning happens in later phases without touching system logic.
 */
export const DEFAULT_GAME_CONFIG: GameConfig = {
  arena: {
    width: 1600,
    height: 900,
  },
  match: {
    sessionDurationSeconds: 120,
    enemySpawnIntervalSeconds: 5,
    enemyDistribution: { chaserWeight: 1, shooterWeight: 1 },
  },
  player: {
    maxHealth: 100,
    moveSpeed: 180,
    rotationSpeed: Math.PI,
    collisionRadius: 30,
  },
  enemies: {
    chaser: {
      maxHealth: 30,
      moveSpeed: 140,
      rotationSpeed: Math.PI * 0.75,
      collisionDamage: 25,
      collisionRadius: 30,
    },
    shooter: {
      maxHealth: 50,
      moveSpeed: 100,
      rotationSpeed: Math.PI * 0.6,
      attackRange: 320,
      fireCooldownSeconds: 1.6,
      collisionRadius: 30,
    },
  },
  projectiles: {
    frontDamage: 10,
    broadsideDamage: 10,
    enemyDamage: 10,
    speed: 420,
    lifetimeSeconds: 1.2,
    collisionRadius: 5,
    frontFireCooldownSeconds: 0.5,
    broadsideFireCooldownSeconds: 1.5,
  },
}
