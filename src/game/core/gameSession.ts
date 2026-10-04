import {
  snapshotGameConfig,
  type GameConfig,
  type GameConfigSnapshot,
} from '../config/gameConfig'
import { DEFAULT_ISLANDS, PLAYER_SPAWN, type IslandObstacle } from '../config/arenaLayout'
import type { EnemyDrive, EnemyState, EnemyType } from '../entities/enemy'
import { createPlayerState, type PlayerState, type Vec2 } from '../entities/player'
import type { Projectile } from '../entities/projectile'
import { createEmptyMovementIntent, type MovementIntent } from '../input/movementIntent'
import { createEmptyWeaponIntent, type WeaponIntent } from '../input/weaponIntent'
import { computeChaserDrive } from '../systems/chaserAi'
import { resolveShipCollisions } from '../systems/collision'
import { applyDamage } from '../systems/damage'
import { updateEnemyMovement } from '../systems/enemyMovement'
import { updatePlayerMovement } from '../systems/playerMovement'
import { updateProjectiles } from '../systems/projectiles'
import { computeShooterDecision, SHOOTER_AIM_TOLERANCE } from '../systems/shooterAi'
import {
  computeSafeSpawnDistance,
  pickEnemyType,
  tryFindSpawnPosition,
} from '../systems/spawnSystem'
import { wrapAngle } from './angles'
import { headingBetween } from '../systems/kinematics'
import { createWeaponsState, frontShot, updatePlayerWeapons, type WeaponsState } from '../systems/weapons'
import type { Clock } from './clock'
import { createRandomSeed, createSeededRandom, type RandomSource } from './random'

/**
 * Simulation advances in fixed steps (60 steps per simulated second) driven
 * by a variable-rate caller: frame delta is accumulated and consumed in
 * FIXED_STEP_SECONDS chunks. This keeps movement, cooldowns and future
 * collisions reproducible regardless of the display frame rate.
 */
export const FIXED_STEP_SECONDS = 1 / 60

/**
 * A single tick never advances the simulation by more than this, no matter
 * how long the wall-clock gap was (breakpoints, frozen tabs, OS sleep).
 * Larger gaps are discarded — match duration is measured in active
 * simulated time, so losing frozen wall time is the correct behavior and
 * prevents a catch-up spiral (max 15 steps per tick).
 */
export const MAX_FRAME_DELTA_SECONDS = 0.25

export type GameSessionState = 'ready' | 'running' | 'paused' | 'ended' | 'destroyed'

/** Why the match ended. Abandonment is NOT an end reason: an abandoned
 * session is destroyed without ever ending, and produces no result. */
export type EndReason = 'player-death' | 'time-expired'

/**
 * Minimal completed-match result (challenge-required fields only; the
 * PHASE 16 API contracts will build on top). Created exactly once, in
 * the core, when a session ends with a real reason. No dates here —
 * timestamps belong to the persistence/integration layer.
 */
export interface MatchResult {
  score: number
  durationPlayedSeconds: number
  endReason: EndReason
  config: GameConfigSnapshot
}

/**
 * Discrete visual events produced by the simulation for the renderer
 * (muzzle flashes, impact bursts). Drained once per rendered frame via
 * {@link GameSession.consumeVisualEvents}; deliberately not a generic bus.
 */
export type SessionVisualEvent =
  | { type: 'shot'; x: number; y: number }
  | { type: 'impact'; x: number; y: number }
  | { type: 'explosion'; x: number; y: number }

/**
 * Simulation-domain events, deliberately separate from the visual queue:
 * PHASE 10's health system consumes these to apply damage. A visual
 * effect disappearing must never erase gameplay information.
 */
export type CombatEvent =
  | {
      type: 'chaserImpact'
      enemyId: number
      x: number
      y: number
      /** Damage from this session's config snapshot, applied in PHASE 10. */
      damage: number
    }
  | {
      type: 'enemyProjectileHit'
      projectileId: number
      x: number
      y: number
      /** Damage from this session's config snapshot, applied in PHASE 10. */
      damage: number
    }

const NO_EVENTS: readonly SessionVisualEvent[] = Object.freeze([])
const NO_COMBAT_EVENTS: readonly CombatEvent[] = Object.freeze([])

export interface GameSessionOptions {
  config: GameConfig
  clock: Clock
  /** Omit in production (random seed); pass a fixed value for reproducible runs. */
  seed?: number
  /** Player spawn point in logical arena pixels. Defaults to PLAYER_SPAWN. */
  playerStart?: Vec2
  /** Island obstacles. Defaults to the deterministic DEFAULT_ISLANDS layout. */
  islands?: readonly IslandObstacle[]
}

/**
 * Core simulation session. Pure TypeScript: no React, no Pixi, no DOM.
 * Rendering observes it; an external driver (later the Pixi ticker adapter)
 * calls {@link tick} once per frame while gameplay is on screen.
 */
export class GameSession {
  readonly config: GameConfigSnapshot
  readonly seed: number
  readonly random: RandomSource
  /** Simulation-owned player state; renderers read it, never write it. */
  readonly player: PlayerState
  /** Immutable island collision geometry for this session. */
  readonly islands: readonly Readonly<IslandObstacle>[]

  private readonly playerIntent: MovementIntent = createEmptyMovementIntent()
  private readonly weaponIntent: WeaponIntent = createEmptyWeaponIntent()
  private readonly weapons: WeaponsState = createWeaponsState()
  private readonly projectilesList: Projectile[] = []
  private readonly enemiesList: EnemyState[] = []
  private readonly enemyDrives = new Map<number, EnemyDrive>()
  /** Per-shooter fire cooldown remaining, in simulation seconds. */
  private readonly shooterCooldowns = new Map<number, number>()
  private visualEvents: SessionVisualEvent[] = []
  private combatEvents: CombatEvent[] = []
  private nextProjectileId = 1
  private nextEnemyId = 1
  private shotsFiredTotal = 0
  private islandImpactsTotal = 0
  private chaserImpactsTotal = 0
  private enemyProjectileHitsTotal = 0
  private scoreValue = 0
  private endReasonValue: EndReason | null = null
  private matchResultValue: MatchResult | null = null
  private spawnCooldownRemaining: number
  private automaticSpawnsTotal = 0
  private spawnFailuresTotal = 0
  private readonly autoSpawnedTypes = new Set<EnemyType>()
  private readonly clock: Clock
  private currentState: GameSessionState = 'ready'
  private activeElapsed = 0
  private accumulator = 0
  private lastNow = 0
  private steps = 0

  constructor(options: GameSessionOptions) {
    this.config = snapshotGameConfig(options.config)
    this.clock = options.clock
    this.seed = options.seed ?? createRandomSeed()
    this.random = createSeededRandom(this.seed)
    this.islands = Object.freeze(
      (options.islands ?? DEFAULT_ISLANDS).map((island) => Object.freeze({ ...island })),
    )
    this.player = createPlayerState(options.playerStart ?? PLAYER_SPAWN, this.config.player.maxHealth)
    // First automatic spawn happens only after one FULL interval of
    // active play (never immediately), giving the player time to orient.
    this.spawnCooldownRemaining = this.config.match.enemySpawnIntervalSeconds
    this.assertValidSpawn()
  }

  private assertValidSpawn(): void {
    this.assertPlacementClear('Player spawn', this.player.position, this.config.player.collisionRadius)
  }

  /** Shared placement validation: inside bounds, outside every island. */
  private assertPlacementClear(label: string, position: Vec2, radius: number): void {
    const { x, y } = position
    const { width, height } = this.config.arena
    if (x < radius || x > width - radius || y < radius || y > height - radius) {
      throw new Error(`${label} (${x}, ${y}) is outside the arena bounds`)
    }
    for (const island of this.islands) {
      const minDistance = radius + island.radius
      if (Math.hypot(x - island.x, y - island.y) < minDistance) {
        throw new Error(`${label} (${x}, ${y}) intersects ${island.id}`)
      }
    }
  }

  private enemyConfigFor(type: EnemyType) {
    return type === 'chaser' ? this.config.enemies.chaser : this.config.enemies.shooter
  }

  /**
   * Creates an enemy at a validated position. This phase's deterministic
   * entry point for tests and later for the periodic spawn system — the
   * "far enough from the player" rule of the real spawner is PHASE 11.
   * @throws Error when the placement is invalid or the session is over.
   */
  spawnEnemy(type: EnemyType, position: Vec2, rotation = 0): Readonly<EnemyState> {
    // Paused is allowed: spawning creates state without advancing the
    // simulation, which lets tests assert exact spawn positions.
    this.assertState('spawnEnemy in', 'ready', 'running', 'paused')
    const config = this.enemyConfigFor(type)
    this.assertPlacementClear(`${type} spawn`, position, config.collisionRadius)

    const playerClearance = config.collisionRadius + this.config.player.collisionRadius
    const { x, y } = this.player.position
    if (Math.hypot(position.x - x, position.y - y) < playerClearance) {
      throw new Error(`${type} spawn (${position.x}, ${position.y}) overlaps the player`)
    }

    const enemy: EnemyState = {
      id: this.nextEnemyId++,
      type,
      position: { x: position.x, y: position.y },
      rotation,
      health: config.maxHealth,
    }
    this.enemiesList.push(enemy)
    return enemy
  }

  /** Removes an enemy from the simulation entirely. */
  removeEnemy(id: number): boolean {
    const index = this.enemiesList.findIndex((enemy) => enemy.id === id)
    if (index === -1) return false
    this.enemiesList.splice(index, 1)
    this.enemyDrives.delete(id)
    this.shooterCooldowns.delete(id)
    return true
  }

  /**
   * Sets a manual movement command (dev/test only in practice).
   * Chasers are AI-controlled in production; allowing a manual drive to
   * silently override that would hide bugs, so it throws instead.
   * For Shooters a manual drive takes FULL control explicitly: it
   * replaces the Shooter AI, including firing (used by base-movement
   * tests; production never sets manual drives).
   */
  setEnemyDrive(id: number, drive: EnemyDrive): void {
    const enemy = this.enemiesList.find((entry) => entry.id === id)
    if (!enemy) return
    if (enemy.type === 'chaser') {
      throw new Error('Chaser movement is AI-controlled; manual drives are not allowed')
    }
    this.enemyDrives.set(id, { targetHeading: drive.targetHeading, forward: drive.forward })
  }

  /** Read-only view of the live enemies. Renderers must not mutate it. */
  get enemies(): readonly Readonly<EnemyState>[] {
    return this.enemiesList
  }

  /**
   * Copies the given intent into the session. Input adapters (keyboard,
   * touch, tests) call this; the simulation reads the stored intent once
   * per fixed step. Safe to call in any state — a non-running session
   * never steps, so intents cannot accumulate into movement.
   */
  setPlayerIntent(intent: MovementIntent): void {
    this.playerIntent.forward = intent.forward
    this.playerIntent.turnLeft = intent.turnLeft
    this.playerIntent.turnRight = intent.turnRight
  }

  /** Same contract as {@link setPlayerIntent}, for the attack inputs. */
  setWeaponIntent(intent: WeaponIntent): void {
    this.weaponIntent.fireFront = intent.fireFront
    this.weaponIntent.fireLeft = intent.fireLeft
    this.weaponIntent.fireRight = intent.fireRight
  }

  /** Read-only view of the live projectiles. Renderers must not mutate it. */
  get projectiles(): readonly Readonly<Projectile>[] {
    return this.projectilesList
  }

  /** Remaining weapon cooldowns in seconds (copies, safe to expose). */
  get weaponCooldowns(): { front: number; left: number; right: number } {
    return { ...this.weapons }
  }

  /** Cumulative projectiles fired this session (deterministic, test-friendly). */
  get totalShotsFired(): number {
    return this.shotsFiredTotal
  }

  /** Cumulative island impacts this session. */
  get totalIslandImpacts(): number {
    return this.islandImpactsTotal
  }

  /** Cumulative Chaser self-destruct impacts on the player this session. */
  get totalChaserImpacts(): number {
    return this.chaserImpactsTotal
  }

  /** Cumulative enemy projectile hits on the player this session. */
  get totalEnemyProjectileHits(): number {
    return this.enemyProjectileHitsTotal
  }

  /** +1 per enemy destroyed by a player attack. Nothing else scores. */
  get score(): number {
    return this.scoreValue
  }

  /** Why the match ended, when it has. */
  get endReason(): EndReason | null {
    return this.endReasonValue
  }

  /** Seconds of active play left; the single match timer, derived from
   * activeElapsed — no second clock exists. */
  get remainingSeconds(): number {
    return Math.max(0, this.config.match.sessionDurationSeconds - this.activeElapsed)
  }

  /**
   * The completed-match result, or null while the match has not ended
   * with a real reason (an abandoned/destroyed session never gets one).
   */
  get matchResult(): MatchResult | null {
    return this.matchResultValue
  }

  /** Enemies created by the periodic spawner (manual spawns excluded). */
  get totalAutomaticSpawns(): number {
    return this.automaticSpawnsTotal
  }

  /** Spawn intervals skipped because no valid position was found. */
  get totalSpawnFailures(): number {
    return this.spawnFailuresTotal
  }

  /** Seconds of active play left until the next automatic spawn attempt. */
  get spawnCooldownSeconds(): number {
    return this.spawnCooldownRemaining
  }

  /**
   * Returns the simulation-domain combat events produced since the last
   * call and clears the queue (each event is consumable exactly once).
   * PHASE 10's health integration is the production consumer.
   */
  consumeCombatEvents(): readonly CombatEvent[] {
    if (this.combatEvents.length === 0) return NO_COMBAT_EVENTS
    const events = this.combatEvents
    this.combatEvents = []
    return events
  }

  /**
   * Returns the visual events produced since the last call and clears the
   * queue. Intended to be called once per rendered frame by the scene.
   */
  consumeVisualEvents(): readonly SessionVisualEvent[] {
    if (this.visualEvents.length === 0) return NO_EVENTS
    const events = this.visualEvents
    this.visualEvents = []
    return events
  }

  get state(): GameSessionState {
    return this.currentState
  }

  /** Active (unpaused) simulated play time, in seconds. */
  get activeElapsedSeconds(): number {
    return this.activeElapsed
  }

  /** Number of fixed steps simulated so far. */
  get stepsSimulated(): number {
    return this.steps
  }

  start(): void {
    this.assertState('start', 'ready')
    this.currentState = 'running'
    this.lastNow = this.clock.now()
  }

  pause(): void {
    this.assertState('pause', 'running')
    this.currentState = 'paused'
    // Held keys must not survive a pause: the player presses again after
    // resuming (the input adapters also clear their own pressed state).
    this.setPlayerIntent(createEmptyMovementIntent())
    this.setWeaponIntent(createEmptyWeaponIntent())
  }

  /** Resumes without replaying the wall time spent paused. */
  resume(): void {
    this.assertState('resume', 'paused')
    this.currentState = 'running'
    this.lastNow = this.clock.now()
  }

  end(reason: EndReason | null = null): void {
    this.assertState('end', 'running', 'paused')
    this.currentState = 'ended'
    this.endReasonValue = reason
    if (reason && !this.matchResultValue) {
      this.matchResultValue = {
        score: this.scoreValue,
        durationPlayedSeconds: Math.min(
          this.activeElapsed,
          this.config.match.sessionDurationSeconds,
        ),
        endReason: reason,
        config: this.config,
      }
    }
  }

  /** Idempotent; a destroyed session never advances or transitions again. */
  destroy(): void {
    this.currentState = 'destroyed'
    this.projectilesList.length = 0
    this.enemiesList.length = 0
    this.enemyDrives.clear()
    this.shooterCooldowns.clear()
    this.visualEvents.length = 0
    this.combatEvents.length = 0
  }

  /**
   * Advances the simulation up to the current clock time. No-op unless
   * running. Call once per rendered frame.
   */
  tick(): void {
    if (this.currentState !== 'running') return

    const now = this.clock.now()
    const frameDelta = Math.min(Math.max(now - this.lastNow, 0), MAX_FRAME_DELTA_SECONDS)
    this.lastNow = now

    this.accumulator += frameDelta
    while (this.accumulator >= FIXED_STEP_SECONDS) {
      this.accumulator -= FIXED_STEP_SECONDS
      this.step(FIXED_STEP_SECONDS)
      // Future systems may end the match mid-tick (e.g. player death).
      if (this.currentState !== 'running') break
    }
  }

  private step(deltaSeconds: number): void {
    this.activeElapsed += deltaSeconds
    this.steps += 1
    // Timer expiry is checked FIRST, before any gameplay of this step:
    // the step that reaches the session duration ends the match
    // immediately, so nothing (enemy fire, chaser impact, player death)
    // can happen "after time". Deterministic rule: on the boundary step,
    // time always wins over death.
    if (this.activeElapsed >= this.config.match.sessionDurationSeconds) {
      this.end('time-expired')
      return
    }
    updatePlayerMovement(this.player, this.playerIntent, this.config.player, deltaSeconds)
    resolveShipCollisions(
      this.player.position,
      this.config.player.collisionRadius,
      this.islands,
      this.config.arena.width,
      this.config.arena.height,
    )
    updatePlayerWeapons(
      this.weapons,
      this.weaponIntent,
      this.player,
      this.config.projectiles,
      deltaSeconds,
      (shot, damage) => {
        this.projectilesList.push({
          id: this.nextProjectileId++,
          owner: 'player',
          position: { ...shot.origin },
          direction: { ...shot.direction },
          speed: this.config.projectiles.speed,
          damage,
          radius: this.config.projectiles.collisionRadius,
          lifetimeRemaining: this.config.projectiles.lifetimeSeconds,
        })
        this.shotsFiredTotal += 1
        this.visualEvents.push({ type: 'shot', x: shot.origin.x, y: shot.origin.y })
      },
    )
    // Step order (deterministic, documented): player moved above, then
    // player weapons; now each enemy acts on the player's UPDATED
    // position — Chasers and Shooters compute their AI drive fresh every
    // step (a manual dev/test drive fully replaces a Shooter's AI).
    // Chaser impacts are detected right after movement, Shooters fire
    // AFTER moving — so the shot matches the step's FINAL position and
    // rotation — and projectiles advance last, including the fresh shots.
    for (const enemy of this.enemiesList) {
      const drive =
        enemy.type === 'chaser'
          ? computeChaserDrive(enemy, this.player.position)
          : (this.enemyDrives.get(enemy.id) ??
            computeShooterDecision(enemy, this.player.position, this.config.enemies.shooter.attackRange)
              .drive)
      updateEnemyMovement(
        enemy,
        drive,
        this.enemyConfigFor(enemy.type),
        deltaSeconds,
        this.islands,
        this.config.arena.width,
        this.config.arena.height,
      )
    }
    this.detectChaserImpacts()
    // A chaser impact can kill the player and end the session mid-step:
    // nothing else may advance or deal damage afterwards.
    if (this.currentState !== 'running') return
    this.updateShooterWeapons(deltaSeconds)
    updateProjectiles(
      this.projectilesList,
      deltaSeconds,
      this.islands,
      this.config.arena.width,
      this.config.arena.height,
      (x, y) => {
        this.islandImpactsTotal += 1
        this.visualEvents.push({ type: 'impact', x, y })
      },
      {
        x: this.player.position.x,
        y: this.player.position.y,
        radius: this.config.player.collisionRadius,
      },
      (projectile) => {
        this.enemyProjectileHitsTotal += 1
        this.combatEvents.push({
          type: 'enemyProjectileHit',
          projectileId: projectile.id,
          x: projectile.position.x,
          y: projectile.position.y,
          damage: projectile.damage,
        })
        this.visualEvents.push({
          type: 'impact',
          x: projectile.position.x,
          y: projectile.position.y,
        })
        // Damage is applied HERE in the core, in the same fixed step —
        // never dependent on anyone consuming the combat event queue.
        this.damagePlayer(projectile.damage)
      },
      this.enemiesList,
      (enemy) => this.enemyConfigFor(enemy.type).collisionRadius,
      (projectile, enemy) => {
        this.hitEnemy(enemy, projectile.damage)
      },
    )
    // Spawning runs LAST in the step: a newborn enemy only starts
    // acting (AI, movement, fire, impact) on the NEXT fixed step —
    // predictable, and spawn→fire in the same instant is impossible.
    this.updateSpawning(deltaSeconds)
  }

  /**
   * Chaser × player circle test. An overlapping Chaser self-destructs:
   * exactly one combat event (carrying the configured damage for the
   * PHASE 10 health system), one explosion visual, immediate removal —
   * it can never impact twice and never scores.
   */
  private detectChaserImpacts(): void {
    const playerRadius = this.config.player.collisionRadius
    const chaserConfig = this.config.enemies.chaser
    const { x: px, y: py } = this.player.position
    for (let i = this.enemiesList.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemiesList[i]!
      if (enemy.type !== 'chaser') continue
      const minDistance = chaserConfig.collisionRadius + playerRadius
      const dx = enemy.position.x - px
      const dy = enemy.position.y - py
      if (dx * dx + dy * dy >= minDistance * minDistance) continue

      this.enemiesList.splice(i, 1)
      this.enemyDrives.delete(enemy.id)
      this.chaserImpactsTotal += 1
      this.combatEvents.push({
        type: 'chaserImpact',
        enemyId: enemy.id,
        x: enemy.position.x,
        y: enemy.position.y,
        damage: chaserConfig.collisionDamage,
      })
      this.visualEvents.push({ type: 'explosion', x: enemy.position.x, y: enemy.position.y })
      // Self-destruction damages the player (and never scores).
      this.damagePlayer(chaserConfig.collisionDamage)
      if (this.currentState !== 'running') return
    }
  }

  /**
   * Applies damage to the player inside the core, clamped at 0. When
   * health reaches zero the session ends immediately with the
   * 'player-death' reason — movement, weapons, AI and damage all stop
   * through the existing lifecycle. Idempotent after death.
   */
  private damagePlayer(damage: number): void {
    if (this.currentState !== 'running' || this.player.health <= 0) return
    this.player.health = applyDamage(this.player.health, damage)
    if (this.player.health <= 0) {
      // Death feedback: the explosion visual is queued BEFORE the end so
      // the renderer materializes it on its next sync even though the
      // simulation freezes in this very step.
      this.visualEvents.push({
        type: 'explosion',
        x: this.player.position.x,
        y: this.player.position.y,
      })
      this.end('player-death')
    }
  }

  /**
   * Applies player-attack damage to an enemy. A lethal hit removes the
   * enemy from the simulation in the same fixed step (no AI, collision,
   * fire or targeting afterwards), scores exactly +1 and explodes once —
   * overkill included.
   */
  private hitEnemy(enemy: EnemyState, damage: number): void {
    if (this.currentState !== 'running') return // frozen mid-step by player death
    enemy.health = applyDamage(enemy.health, damage)
    if (enemy.health > 0) {
      this.visualEvents.push({ type: 'impact', x: enemy.position.x, y: enemy.position.y })
      return
    }
    const index = this.enemiesList.indexOf(enemy)
    if (index === -1) return // already removed (defensive; cannot double-score)
    this.enemiesList.splice(index, 1)
    this.enemyDrives.delete(enemy.id)
    this.shooterCooldowns.delete(enemy.id)
    this.scoreValue += 1
    this.visualEvents.push({ type: 'explosion', x: enemy.position.x, y: enemy.position.y })
  }

  /**
   * Per-shooter cooldown bookkeeping and firing, AFTER movement so the
   * shot uses this step's final position/rotation. Each Shooter owns an
   * independent timer; a manually driven Shooter (dev/test) never fires.
   * The projectile's direction is the ship's CURRENT facing (no homing),
   * spawned at the shared bow hardpoint (same hull art as the player).
   */
  private updateShooterWeapons(deltaSeconds: number): void {
    const shooterConfig = this.config.enemies.shooter
    const projectilesConfig = this.config.projectiles
    for (const enemy of this.enemiesList) {
      if (enemy.type !== 'shooter') continue

      const remaining = Math.max(0, (this.shooterCooldowns.get(enemy.id) ?? 0) - deltaSeconds)
      this.shooterCooldowns.set(enemy.id, remaining)
      if (remaining > 0) continue
      if (this.enemyDrives.has(enemy.id)) continue // manual control: AI fire disabled

      const dx = this.player.position.x - enemy.position.x
      const dy = this.player.position.y - enemy.position.y
      if (dx * dx + dy * dy > shooterConfig.attackRange * shooterConfig.attackRange) continue
      const aimError = Math.abs(
        wrapAngle(headingBetween(enemy.position, this.player.position) - enemy.rotation),
      )
      if (aimError > SHOOTER_AIM_TOLERANCE) continue

      const shot = frontShot(enemy)
      this.projectilesList.push({
        id: this.nextProjectileId++,
        owner: 'enemy',
        position: { ...shot.origin },
        direction: { ...shot.direction },
        speed: projectilesConfig.speed,
        damage: projectilesConfig.enemyDamage,
        radius: projectilesConfig.collisionRadius,
        lifetimeRemaining: projectilesConfig.lifetimeSeconds,
      })
      this.visualEvents.push({ type: 'shot', x: shot.origin.x, y: shot.origin.y })
      this.shooterCooldowns.set(enemy.id, shooterConfig.fireCooldownSeconds)
    }
  }

  /**
   * Periodic spawner. The timer only advances inside fixed steps (so it
   * freezes on pause, never catches up, and stops at end/destroy with the
   * rest of the lifecycle). The cooldown resets every interval whether or
   * not a position was found; a failed search just skips that interval.
   */
  private updateSpawning(deltaSeconds: number): void {
    this.spawnCooldownRemaining -= deltaSeconds
    if (this.spawnCooldownRemaining > 0) return
    this.spawnCooldownRemaining = this.config.match.enemySpawnIntervalSeconds

    const type = this.selectSpawnType()
    const config = this.enemyConfigFor(type)
    const position = tryFindSpawnPosition({
      random: this.random,
      arenaWidth: this.config.arena.width,
      arenaHeight: this.config.arena.height,
      enemyRadius: config.collisionRadius,
      islands: this.islands,
      playerPosition: this.player.position,
      safeDistanceFromPlayer: computeSafeSpawnDistance(this.config),
      enemies: this.enemiesList,
      enemyRadiusFor: (enemy) => this.enemyConfigFor(enemy.type).collisionRadius,
    })
    if (!position) {
      this.spawnFailuresTotal += 1
      return
    }
    this.spawnEnemy(type, position)
    this.automaticSpawnsTotal += 1
    this.autoSpawnedTypes.add(type)
  }

  /**
   * Weighted pick with one guarantee: while both weights are > 0 and only
   * one type has auto-spawned so far, the missing type is forced (without
   * consuming RNG), so a standard match always shows both enemy kinds.
   * A zero weight disables its type completely — never forced.
   */
  private selectSpawnType(): EnemyType {
    const { chaserWeight, shooterWeight } = this.config.match.enemyDistribution
    if (chaserWeight > 0 && shooterWeight > 0 && this.autoSpawnedTypes.size === 1) {
      return this.autoSpawnedTypes.has('chaser') ? 'shooter' : 'chaser'
    }
    return pickEnemyType(this.random, chaserWeight, shooterWeight)
  }

  private assertState(action: string, ...allowed: GameSessionState[]): void {
    if (!allowed.includes(this.currentState)) {
      throw new Error(
        `Cannot ${action}() a game session in state "${this.currentState}" ` +
          `(allowed: ${allowed.join(', ')})`,
      )
    }
  }
}
