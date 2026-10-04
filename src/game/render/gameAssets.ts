import { Assets, Spritesheet, type Texture } from 'pixi.js'
import chaserExplosionUrl from '../../../assets/png/default/effects/explosion_1.png'
import impactEffectUrl from '../../../assets/png/default/effects/explosion_2.png'
import muzzleFlashUrl from '../../../assets/png/default/effects/explosion_3.png'
import cannonBallUrl from '../../../assets/png/default/ship_parts/cannon_ball.png'
import shipTextureUrl from '../../../assets/png/default/ships/ship_1.png'
import shipDamagedUrl from '../../../assets/png/default/ships/ship_7.png'
import shipHeavyUrl from '../../../assets/png/default/ships/ship_13.png'
import chaserShipUrl from '../../../assets/png/default/ships/ship_2.png'
import chaserDamagedUrl from '../../../assets/png/default/ships/ship_8.png'
import chaserHeavyUrl from '../../../assets/png/default/ships/ship_14.png'
import shooterShipUrl from '../../../assets/png/default/ships/ship_3.png'
import shooterDamagedUrl from '../../../assets/png/default/ships/ship_9.png'
import shooterHeavyUrl from '../../../assets/png/default/ships/ship_15.png'
import islandPlantUrl from '../../../assets/png/default/tiles/tile_71.png'
import waterTextureUrl from '../../../assets/png/default/tiles/tile_73.png'
import islandTopLeftUrl from '../../../assets/png/default/tiles/tile_1.png'
import islandTopUrl from '../../../assets/png/default/tiles/tile_2.png'
import islandTopRightUrl from '../../../assets/png/default/tiles/tile_3.png'
import islandLeftUrl from '../../../assets/png/default/tiles/tile_17.png'
import islandCenterUrl from '../../../assets/png/default/tiles/tile_18.png'
import islandRightUrl from '../../../assets/png/default/tiles/tile_19.png'
import islandBottomLeftUrl from '../../../assets/png/default/tiles/tile_33.png'
import islandBottomUrl from '../../../assets/png/default/tiles/tile_34.png'
import islandBottomRightUrl from '../../../assets/png/default/tiles/tile_35.png'
import uiSheetData from '../../../assets/spritesheet/ui_sheet.json'
import uiSheetTextureUrl from '../../../assets/spritesheet/ui_sheet.png'

/**
 * Row-major 3×3 island patch (64 px tiles, 192×192 px visual). The order
 * matches the visually verified tile semantics: tile_1/2/3 top coast,
 * tile_17/18/19 left/center/right, tile_33/34/35 bottom coast.
 */
const ISLAND_TILE_URLS = [
  islandTopLeftUrl,
  islandTopUrl,
  islandTopRightUrl,
  islandLeftUrl,
  islandCenterUrl,
  islandRightUrl,
  islandBottomLeftUrl,
  islandBottomUrl,
  islandBottomRightUrl,
] as const

export interface GameAssets {
  /** Parsed UI atlas; frame names are compile-time checked against ui_sheet.json. */
  uiSheet: Spritesheet<typeof uiSheetData>
  /**
   * Deterioration tiers [intact, damaged, heavily damaged], visually
   * verified ship families: player ship_1/7/13 (white), chaser
   * ship_2/8/14 (black skull), shooter ship_3/9/15 (red cross).
   */
  playerShipTextures: readonly [Texture, Texture, Texture]
  chaserShipTextures: readonly [Texture, Texture, Texture]
  shooterShipTextures: readonly [Texture, Texture, Texture]
  waterTexture: Texture
  /** Row-major 3×3 island tile textures (see ISLAND_TILE_URLS). */
  islandTileTextures: readonly Texture[]
  islandPlantTexture: Texture
  cannonBallTexture: Texture
  muzzleFlashTexture: Texture
  impactEffectTexture: Texture
  /** explosion_1 (74×75): the large blast for Chaser self-destruction. */
  chaserExplosionTexture: Texture
}

let loadedAssets: GameAssets | null = null
let pendingLoad: Promise<GameAssets> | null = null

/**
 * Loads the textures needed by the current scene exactly once per page.
 * Concurrent callers (e.g. StrictMode double mount) share one in-flight
 * promise. A failed attempt clears the pending promise — and Pixi's Assets
 * loader evicts failed URLs from its own cache — so a retry issues real
 * new requests instead of replaying the failure.
 */
export function loadGameAssets(): Promise<GameAssets> {
  if (loadedAssets) return Promise.resolve(loadedAssets)
  pendingLoad ??= load()
    .then((assets) => {
      loadedAssets = assets
      return assets
    })
    .finally(() => {
      pendingLoad = null
    })
  return pendingLoad
}

async function load(): Promise<GameAssets> {
  const [
    playerShip0,
    playerShip1,
    playerShip2,
    chaserShip0,
    chaserShip1,
    chaserShip2,
    shooterShip0,
    shooterShip1,
    shooterShip2,
    uiSheetTexture,
    waterTexture,
    islandPlantTexture,
    cannonBallTexture,
    muzzleFlashTexture,
    impactEffectTexture,
    chaserExplosionTexture,
    ...islandTileTextures
  ] = await Promise.all([
    Assets.load<Texture>(shipTextureUrl),
    Assets.load<Texture>(shipDamagedUrl),
    Assets.load<Texture>(shipHeavyUrl),
    Assets.load<Texture>(chaserShipUrl),
    Assets.load<Texture>(chaserDamagedUrl),
    Assets.load<Texture>(chaserHeavyUrl),
    Assets.load<Texture>(shooterShipUrl),
    Assets.load<Texture>(shooterDamagedUrl),
    Assets.load<Texture>(shooterHeavyUrl),
    Assets.load<Texture>(uiSheetTextureUrl),
    Assets.load<Texture>(waterTextureUrl),
    Assets.load<Texture>(islandPlantUrl),
    Assets.load<Texture>(cannonBallUrl),
    Assets.load<Texture>(muzzleFlashUrl),
    Assets.load<Texture>(impactEffectUrl),
    Assets.load<Texture>(chaserExplosionUrl),
    ...ISLAND_TILE_URLS.map((url) => Assets.load<Texture>(url)),
  ])
  const uiSheet = new Spritesheet(uiSheetTexture, uiSheetData)
  await uiSheet.parse()
  return {
    uiSheet,
    playerShipTextures: [playerShip0, playerShip1, playerShip2],
    chaserShipTextures: [chaserShip0, chaserShip1, chaserShip2],
    shooterShipTextures: [shooterShip0, shooterShip1, shooterShip2],
    waterTexture,
    islandTileTextures,
    islandPlantTexture,
    cannonBallTexture,
    muzzleFlashTexture,
    impactEffectTexture,
    chaserExplosionTexture,
  }
}
