import { Container, Rectangle, Sprite, Texture, TilingSprite } from 'pixi.js'
import type { GameSession } from '../core/gameSession'
import type { EnemyType } from '../entities/enemy'
import { damageTierFor } from '../systems/damage'
import type { GameAssets } from './gameAssets'

/**
 * The raw ship asset points down (+y) — verified against ship_1.png and the
 * reference screenshots. Simulation rotation 0 means facing up (-y), so the
 * renderer adds this constant. The offset lives here only; simulation math
 * stays canonical.
 */
const SHIP_SPRITE_ROTATION_OFFSET = Math.PI

const TILE_SIZE = 64
const ISLAND_GRID = 3

export interface MatchScene {
  /** Syncs sprites from simulation state. Call once per rendered frame. */
  update(): void
  /** Fits the logical arena into the canvas (visual scale/offset only). */
  layout(width: number, height: number): void
  /** Removes every display object this scene created (used on restart). */
  destroy(): void
}

/**
 * Pixi representation of the match. Simulation state is the single source
 * of truth: this scene reads arena layout and player state and mirrors
 * them onto sprites. World→screen is a uniform scale + centering offset
 * that preserves the arena aspect ratio; simulation coordinates never
 * change with the viewport.
 */
export function buildMatchScene(stage: Container, assets: GameAssets, session: GameSession): MatchScene {
  const arena = session.config.arena
  const world = new Container()
  stage.addChild(world)

  const water = new TilingSprite({
    texture: assets.waterTexture,
    width: arena.width,
    height: arena.height,
  })
  world.addChild(water)

  for (const island of session.islands) {
    const islandContainer = new Container()
    islandContainer.position.set(island.x, island.y)
    const origin = (ISLAND_GRID * TILE_SIZE) / 2
    assets.islandTileTextures.forEach((texture, index) => {
      const tile = new Sprite(texture)
      tile.position.set(
        (index % ISLAND_GRID) * TILE_SIZE - origin,
        Math.floor(index / ISLAND_GRID) * TILE_SIZE - origin,
      )
      islandContainer.addChild(tile)
    })
    const plant = new Sprite(assets.islandPlantTexture)
    plant.anchor.set(0.5)
    islandContainer.addChild(plant)
    world.addChild(islandContainer)
  }

  const projectileLayer = new Container()
  world.addChild(projectileLayer)

  const enemyLayer = new Container()
  world.addChild(enemyLayer)

  const playerSprite = new Sprite(assets.playerShipTextures[0])
  playerSprite.anchor.set(0.5)
  world.addChild(playerSprite)

  const effectsLayer = new Container()
  world.addChild(effectsLayer)

  // Health bars live on the topmost layer, horizontal in world space
  // (they follow ships but never rotate with them).
  const barsLayer = new Container()
  world.addChild(barsLayer)

  /**
   * Over-ship health bar built from the official HUD atlas pieces: the
   * frame sprite plus fill sub-textures cropped to the atlas `ui.alpha_bounds`
   * metadata (so scaling the fill by the health ratio never squeezes the
   * transparent margins). The renderer only turns (health, maxHealth)
   * into a ratio — the simulation is the only authority.
   */
  interface HealthBar {
    container: Container
    setRatio(ratio: number): void
  }

  function cropToFillRegion(texture: Texture, bounds: { x: number; y: number; w: number; h: number }): Texture {
    return new Texture({
      source: texture.source,
      frame: new Rectangle(
        texture.frame.x + bounds.x,
        texture.frame.y + bounds.y,
        bounds.w,
        bounds.h,
      ),
    })
  }

  function createHealthBar(
    kind: 'player' | 'enemy',
    scale: number,
  ): HealthBar {
    const sheet = assets.uiSheet
    const frames = sheet.data.frames
    const frameTexture = kind === 'player' ? sheet.textures.health_frame : sheet.textures.enemy_health_frame
    const frameData = kind === 'player' ? frames.health_frame : frames.enemy_health_frame
    const fillBounds =
      kind === 'player'
        ? frames.health_fill_green.ui.alpha_bounds
        : frames.enemy_health_fill_green.ui.alpha_bounds
    const fillTextures =
      kind === 'player'
        ? {
            high: cropToFillRegion(sheet.textures.health_fill_green, fillBounds),
            mid: cropToFillRegion(sheet.textures.health_fill_amber, fillBounds),
            low: cropToFillRegion(sheet.textures.health_fill_red, fillBounds),
          }
        : {
            high: cropToFillRegion(sheet.textures.enemy_health_fill_green, fillBounds),
            mid: cropToFillRegion(sheet.textures.enemy_health_fill_red, fillBounds),
            low: cropToFillRegion(sheet.textures.enemy_health_fill_red, fillBounds),
          }

    const container = new Container()
    container.scale.set(scale)
    const frame = new Sprite(frameTexture)
    frame.anchor.set(0.5)
    const fill = new Sprite(fillTextures.high)
    fill.position.set(-frameData.frame.w / 2 + fillBounds.x, -frameData.frame.h / 2 + fillBounds.y)
    // The frame art has an opaque dark interior: it is the backdrop, the
    // fill goes on top of it.
    container.addChild(frame, fill)
    barsLayer.addChild(container)

    return {
      container,
      setRatio(ratio) {
        const clamped = Math.max(0, Math.min(1, ratio))
        fill.scale.x = clamped
        fill.texture = clamped > 0.5 ? fillTextures.high : clamped > 0.25 ? fillTextures.mid : fillTextures.low
      },
    }
  }

  const playerBar = createHealthBar('player', 0.34)
  const enemyBars = new Map<number, HealthBar>()

  const PLAYER_BAR_OFFSET_Y = -78
  const ENEMY_BAR_OFFSET_Y = -72

  // Short red tint when the player takes damage (visual feedback only).
  let lastPlayerHealth = session.player.health
  let playerHitFlashFrames = 0

  const projectileSprites = new Map<number, Sprite>()
  const liveProjectileIds = new Set<number>() // reused every frame, no churn

  const enemyTextures: Record<EnemyType, readonly [Texture, Texture, Texture]> = {
    chaser: assets.chaserShipTextures,
    shooter: assets.shooterShipTextures,
  }
  const enemySprites = new Map<number, Sprite>()
  const liveEnemyIds = new Set<number>()

  /**
   * Purely visual, short-lived sprites (muzzle flash, impact burst).
   * They decay per rendered frame — never part of the simulation — and
   * freeze while the session is not running, matching pause semantics.
   */
  interface VisualEffect {
    sprite: Sprite
    remainingFrames: number
    totalFrames: number
  }
  const effects: VisualEffect[] = []

  const EFFECT_STYLES = {
    shot: { texture: assets.muzzleFlashTexture, scale: 0.6, frames: 10 },
    impact: { texture: assets.impactEffectTexture, scale: 0.9, frames: 18 },
    // Chaser self-destruct: the big official explosion, briefly.
    explosion: { texture: assets.chaserExplosionTexture, scale: 1.2, frames: 26 },
  } as const

  function spawnEffect(x: number, y: number, kind: keyof typeof EFFECT_STYLES): void {
    const style = EFFECT_STYLES[kind]
    const sprite = new Sprite(style.texture)
    sprite.anchor.set(0.5)
    sprite.position.set(x, y)
    sprite.scale.set(style.scale)
    effectsLayer.addChild(sprite)
    effects.push({ sprite, remainingFrames: style.frames, totalFrames: style.frames })
  }

  function update(): void {
    const { position, rotation, health } = session.player
    playerSprite.position.set(position.x, position.y)
    playerSprite.rotation = rotation + SHIP_SPRITE_ROTATION_OFFSET
    // Visual deterioration (texture only — collision never changes).
    playerSprite.texture =
      assets.playerShipTextures[damageTierFor(health, session.config.player.maxHealth)]
    playerBar.container.position.set(position.x, position.y + PLAYER_BAR_OFFSET_Y)
    playerBar.setRatio(health / session.config.player.maxHealth)

    if (health < lastPlayerHealth) playerHitFlashFrames = 9
    lastPlayerHealth = health

    // Mirror simulation projectiles onto sprites (core owns lifetime).
    liveProjectileIds.clear()
    for (const projectile of session.projectiles) {
      liveProjectileIds.add(projectile.id)
      let sprite = projectileSprites.get(projectile.id)
      if (!sprite) {
        sprite = new Sprite(assets.cannonBallTexture)
        sprite.anchor.set(0.5)
        // Readability with many ships: enemy balls get a subtle warm
        // tint so the player instantly knows which shots can hurt them.
        if (projectile.owner === 'enemy') sprite.tint = 0xffa08a
        projectileSprites.set(projectile.id, sprite)
        projectileLayer.addChild(sprite)
      }
      sprite.position.set(projectile.position.x, projectile.position.y)
    }
    for (const [id, sprite] of projectileSprites) {
      if (!liveProjectileIds.has(id)) {
        sprite.destroy()
        projectileSprites.delete(id)
      }
    }

    // Mirror simulation enemies onto sprites (core owns the collection).
    liveEnemyIds.clear()
    for (const enemy of session.enemies) {
      liveEnemyIds.add(enemy.id)
      let sprite = enemySprites.get(enemy.id)
      if (!sprite) {
        sprite = new Sprite(enemyTextures[enemy.type][0])
        sprite.anchor.set(0.5)
        enemySprites.set(enemy.id, sprite)
        enemyLayer.addChild(sprite)
      }
      sprite.position.set(enemy.position.x, enemy.position.y)
      sprite.rotation = enemy.rotation + SHIP_SPRITE_ROTATION_OFFSET
      const maxHealth = session.config.enemies[enemy.type].maxHealth
      sprite.texture = enemyTextures[enemy.type][damageTierFor(enemy.health, maxHealth)]

      let bar = enemyBars.get(enemy.id)
      if (!bar) {
        bar = createHealthBar('enemy', 0.4)
        enemyBars.set(enemy.id, bar)
      }
      bar.container.position.set(enemy.position.x, enemy.position.y + ENEMY_BAR_OFFSET_Y)
      bar.setRatio(enemy.health / maxHealth)
    }
    for (const [id, sprite] of enemySprites) {
      if (!liveEnemyIds.has(id)) {
        sprite.destroy()
        enemySprites.delete(id)
        const bar = enemyBars.get(id)
        if (bar) {
          bar.container.destroy({ children: true })
          enemyBars.delete(id)
        }
      }
    }

    for (const event of session.consumeVisualEvents()) {
      spawnEffect(event.x, event.y, event.type)
    }

    // Effects decay while running AND after the match ended (the death
    // explosion must play out over the frozen scene); only pause truly
    // freezes them.
    if (session.state !== 'paused') {
      if (playerHitFlashFrames > 0) {
        playerHitFlashFrames -= 1
        playerSprite.tint = 0xff7070
      } else {
        playerSprite.tint = 0xffffff
      }
      for (let i = effects.length - 1; i >= 0; i -= 1) {
        const effect = effects[i]!
        effect.remainingFrames -= 1
        if (effect.remainingFrames <= 0) {
          effect.sprite.destroy()
          effects.splice(i, 1)
        } else {
          effect.sprite.alpha = effect.remainingFrames / effect.totalFrames
        }
      }
    }
  }

  update()

  return {
    update,
    layout(width, height) {
      const scale = Math.min(width / arena.width, height / arena.height)
      world.scale.set(scale)
      world.position.set(
        (width - arena.width * scale) / 2,
        (height - arena.height * scale) / 2,
      )
    },
    destroy() {
      projectileSprites.clear()
      enemySprites.clear()
      enemyBars.clear()
      effects.length = 0
      world.destroy({ children: true }) // shared textures stay cached
    },
  }
}
