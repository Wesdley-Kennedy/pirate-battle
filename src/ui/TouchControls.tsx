import { useEffect, useRef } from 'react'
import iconFireFrontUrl from '../../assets/png/default/ui/controls/icon_fire_front.png'
import iconFireLeftUrl from '../../assets/png/default/ui/controls/icon_fire_left.png'
import iconFireRightUrl from '../../assets/png/default/ui/controls/icon_fire_right.png'
import iconForwardUrl from '../../assets/png/default/ui/controls/icon_forward.png'
import iconTurnLeftUrl from '../../assets/png/default/ui/controls/icon_turn_left.png'
import iconTurnRightUrl from '../../assets/png/default/ui/controls/icon_turn_right.png'
import { createEmptyMovementIntent, type MovementIntent } from '../game/input/movementIntent'
import { createEmptyWeaponIntent, type WeaponIntent } from '../game/input/weaponIntent'

type TouchAction = keyof MovementIntent | keyof WeaponIntent

interface TouchControlsProps {
  /** Callbacks MUST be referentially stable (useCallback) — a changing
   * identity re-runs the cleanup effect and would drop held buttons. */
  onMovementChange: (intent: MovementIntent) => void
  onWeaponChange: (intent: WeaponIntent) => void
}

interface TouchButtonSpec {
  action: TouchAction
  label: string
  icon: string
}

const MOVE_BUTTONS: TouchButtonSpec[] = [
  { action: 'turnLeft', label: 'Turn left', icon: iconTurnLeftUrl },
  { action: 'forward', label: 'Move forward', icon: iconForwardUrl },
  { action: 'turnRight', label: 'Turn right', icon: iconTurnRightUrl },
]

const FIRE_BUTTONS: TouchButtonSpec[] = [
  { action: 'fireLeft', label: 'Fire left broadside', icon: iconFireLeftUrl },
  { action: 'fireFront', label: 'Fire front cannon', icon: iconFireFrontUrl },
  { action: 'fireRight', label: 'Fire right broadside', icon: iconFireRightUrl },
]

/**
 * Touch adapter over the SAME MovementIntent/WeaponIntent the keyboard
 * emits — no mobile-specific gameplay logic exists. Every button owns its
 * pressed state and captures its own pointer, so holding Forward + a turn
 * while tapping Fire with a third finger all works at once. Rendered only
 * while a match is RUNNING; unmounting (pause, end, exit) always emits
 * empty intents so no touch stays "stuck" in the simulation.
 */
export default function TouchControls({ onMovementChange, onWeaponChange }: TouchControlsProps) {
  const pressedRef = useRef(new Set<TouchAction>())

  function emit(): void {
    const movement = createEmptyMovementIntent()
    const weapons = createEmptyWeaponIntent()
    for (const action of pressedRef.current) {
      if (action === 'forward' || action === 'turnLeft' || action === 'turnRight') {
        movement[action] = true
      } else {
        weapons[action] = true
      }
    }
    onMovementChange(movement)
    onWeaponChange(weapons)
  }

  function handlePress(action: TouchAction) {
    return (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault() // no compat mouse events, no focus steal
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Synthetic pointers (tests) may not be capturable — fine.
      }
      if (pressedRef.current.has(action)) return
      pressedRef.current.add(action)
      emit()
    }
  }

  function handleRelease(action: TouchAction) {
    return () => {
      if (!pressedRef.current.delete(action)) return
      emit()
    }
  }

  useEffect(() => {
    const pressed = pressedRef.current
    return () => {
      pressed.clear()
      onMovementChange(createEmptyMovementIntent())
      onWeaponChange(createEmptyWeaponIntent())
    }
  }, [onMovementChange, onWeaponChange])

  function renderCluster(buttons: TouchButtonSpec[], modifier: string) {
    return (
      <div className={`touch-controls__cluster touch-controls__cluster--${modifier}`}>
        {buttons.map((button) => (
          <button
            key={button.action}
            type="button"
            className="touch-button"
            data-touch={button.action}
            aria-label={button.label}
            onPointerDown={handlePress(button.action)}
            onPointerUp={handleRelease(button.action)}
            onPointerCancel={handleRelease(button.action)}
            onContextMenu={(event) => event.preventDefault()}
          >
            <img src={button.icon} alt="" draggable={false} />
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="touch-controls">
      {renderCluster(MOVE_BUTTONS, 'move')}
      {renderCluster(FIRE_BUTTONS, 'fire')}
    </div>
  )
}
