import { createEmptyMovementIntent, type MovementIntent } from './movementIntent'
import { createEmptyWeaponIntent, type WeaponIntent } from './weaponIntent'

export interface KeyboardInputHandle {
  /** Forgets every held key and emits empty intents (used on pause). */
  clearPressed(): void
  destroy(): void
}

export interface KeyboardInputCallbacks {
  onMovementChange(intent: MovementIntent): void
  onWeaponChange(intent: WeaponIntent): void
}

/**
 * Physical key bindings (KeyboardEvent.code — layout independent):
 * W/ArrowUp forward · A/ArrowLeft turn left · D/ArrowRight turn right ·
 * Space front cannon · Q left broadside · E right broadside.
 * Movement and weapons are tracked independently, so W+A+Space or
 * W+D+Q work simultaneously — the groups never block each other.
 */
const MOVEMENT_BINDINGS: Readonly<Record<string, keyof MovementIntent>> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyA: 'turnLeft',
  ArrowLeft: 'turnLeft',
  KeyD: 'turnRight',
  ArrowRight: 'turnRight',
}

const WEAPON_BINDINGS: Readonly<Record<string, keyof WeaponIntent>> = {
  Space: 'fireFront',
  KeyQ: 'fireLeft',
  KeyE: 'fireRight',
}

/**
 * Browser layer translating keyboard events into movement/weapon intents.
 * Attach only while gameplay is active; `destroy()` removes all listeners
 * and emits empty intents so no key stays "stuck" in the simulation.
 * Losing window focus also clears all pressed keys. preventDefault on
 * bound keys keeps arrows/Space from scrolling the page or activating a
 * focused button mid-match.
 */
export function attachKeyboardInput(callbacks: KeyboardInputCallbacks): KeyboardInputHandle {
  const pressedCodes = new Set<string>()

  function emitMovement(): void {
    const intent = createEmptyMovementIntent()
    for (const code of pressedCodes) {
      const binding = MOVEMENT_BINDINGS[code]
      if (binding) intent[binding] = true
    }
    callbacks.onMovementChange(intent)
  }

  function emitWeapons(): void {
    const intent = createEmptyWeaponIntent()
    for (const code of pressedCodes) {
      const binding = WEAPON_BINDINGS[code]
      if (binding) intent[binding] = true
    }
    callbacks.onWeaponChange(intent)
  }

  function handleKeyDown(event: KeyboardEvent): void {
    // Leave browser shortcuts (Ctrl+W, Alt+arrows, ...) alone.
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const isMovement = event.code in MOVEMENT_BINDINGS
    const isWeapon = event.code in WEAPON_BINDINGS
    if (!isMovement && !isWeapon) return
    event.preventDefault()
    if (event.repeat || pressedCodes.has(event.code)) return
    pressedCodes.add(event.code)
    if (isMovement) emitMovement()
    else emitWeapons()
  }

  function handleKeyUp(event: KeyboardEvent): void {
    if (!pressedCodes.delete(event.code)) return
    if (event.code in MOVEMENT_BINDINGS) emitMovement()
    else emitWeapons()
  }

  function handleBlur(): void {
    if (pressedCodes.size === 0) return
    pressedCodes.clear()
    emitMovement()
    emitWeapons()
  }

  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
  window.addEventListener('blur', handleBlur)

  function clearPressed(): void {
    pressedCodes.clear()
    callbacks.onMovementChange(createEmptyMovementIntent())
    callbacks.onWeaponChange(createEmptyWeaponIntent())
  }

  return {
    clearPressed,
    destroy() {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
      clearPressed()
    },
  }
}
