/**
 * Device-independent movement intent. The simulation consumes intents only;
 * keyboard, touch and test instrumentation all translate into this shape.
 * Pure data — no DOM, no events.
 */
export interface MovementIntent {
  forward: boolean
  turnLeft: boolean
  turnRight: boolean
}

export function createEmptyMovementIntent(): MovementIntent {
  return { forward: false, turnLeft: false, turnRight: false }
}
