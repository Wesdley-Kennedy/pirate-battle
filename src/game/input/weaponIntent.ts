/**
 * Device-independent attack intent. Held semantics: while a flag stays
 * true the weapon fires whenever its cooldown allows, so the cooldown —
 * not key-repeat — controls the cadence. Pure data, no DOM.
 */
export interface WeaponIntent {
  fireFront: boolean
  fireLeft: boolean
  fireRight: boolean
}

export function createEmptyWeaponIntent(): WeaponIntent {
  return { fireFront: false, fireLeft: false, fireRight: false }
}
