import type { MatchResult } from '../game/core/gameSession'

/**
 * Local persistence for the LAST COMPLETED match result. Abandoned
 * sessions (destroyed without ending) are never saved, so they can never
 * overwrite a previously completed result. The core never touches
 * browser storage — only this adapter does, and every access is guarded:
 * a failing/blocked localStorage must never break gameplay.
 */
const STORAGE_KEY = 'pirate-battle:last-match-result'

export interface StoredMatchResult extends MatchResult {
  /** ISO timestamp added at save time (timestamps live outside the core). */
  completedAt: string
}

export function saveLastMatchResult(result: MatchResult): void {
  try {
    const stored: StoredMatchResult = { ...result, completedAt: new Date().toISOString() }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // Storage unavailable (private mode, quota, disabled): gameplay goes on.
  }
}

export function loadLastMatchResult(): StoredMatchResult | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const candidate = parsed as StoredMatchResult
    if (typeof candidate.score !== 'number' || typeof candidate.endReason !== 'string') {
      return null
    }
    return candidate
  } catch {
    return null
  }
}

export const LAST_MATCH_STORAGE_KEY = STORAGE_KEY
