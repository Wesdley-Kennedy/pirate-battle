# Architecture

Factual notes on how Pirate Battle is built and why. Paths are relative to `src/`.

## 1. React / Pixi responsibilities

- **React** (`ui/`, `App.tsx`): screen flow (Menu ⇄ Options, Menu → Game), HUD overlays, Options form, Result overlay, Ranking/History boards. Three screens are plain component state — no router, no URL routes.
- **PixiJS** (`game/render/`): one `Application` per game-screen mount, owned by `createPixiStage` (`game/render/pixiStage.ts`). It renders water, islands, ships, projectiles, health bars and effects in `matchScene.ts`, and drives the session from the Pixi ticker.
- **Simulation** (`game/core/`, `game/systems/`, `game/entities/`): pure TypeScript — no React, no Pixi, no DOM. Renderers read its state; nothing outside it mutates gameplay.

## 2. Game loop and fixed timestep

`GameSession.tick()` converts wall-clock deltas (from an injectable `Clock`) into **fixed 1/60 s steps** via an accumulator; frame deltas are clamped to 0.25 s (no catch-up spiral after a frozen tab). All movement, cooldowns, damage and spawning advance only inside steps, so the simulation is frame-rate independent and deterministic. The Pixi ticker merely *provokes* `tick()` — there is a single timeline, no second clock or RAF.

Determinism inputs: a seeded mulberry32 RNG (`core/random.ts`, seed recorded per session) and the injected clock. Tests inject a manual clock (unit) or advance an instrumented real clock (E2E) — every rule still executes.

## 3. Input adapters

Keyboard (`game/input/keyboardInput.ts`) and touch (`ui/TouchControls.tsx`) are adapters that translate into the same `MovementIntent` / `WeaponIntent` pure-data shapes. `pixiStage` merges the two sources with a logical OR before handing a single intent to the session, so simultaneous keyboard+touch is well-defined. Pausing clears intents on both sides; game keys are captured only while the game screen is mounted and `preventDefault` is limited to bound keys. Touch pads use pointer events with per-button pointer capture (real multi-touch), `pointercancel` handling and `touch-action: none` scoped to the pads only.

## 4. Collision model

Circles only: player, enemies, projectiles and islands (`game/systems/collision.ts`). Ship–island and ship–ship resolution is a radial push-out with a 3-pass relaxation plus an arena-bounds clamp, which produces natural sliding along coasts. Tunneling is impossible by construction (max step displacement ≈ 3 px for ships / 7 px for cannonballs vs ≥ 35 px combined radii) and guarded by tests.

## 5. Player weapons and projectiles

Held-fire semantics: while an intent flag is true, the weapon fires whenever its sim-time cooldown allows. The front cannon spawns one ball at a hardpoint ahead of the bow; broadsides spawn **three parallel** balls per side. Projectiles (`game/systems/projectiles.ts`) carry direction, speed, damage, radius and lifetime; they are removed on target hit (one hit max), island impact, arena exit or expiry. Player balls hit enemies; enemy balls hit the player — checked before islands, each step.

## 6. Enemy AI (Chaser / Shooter)

AI functions are stateless and only produce an `EnemyDrive` (`{targetHeading, forward}`):

- **Chaser** (`chaserAi.ts`): direct pursuit; on contact it deals its collision damage, explodes and is removed the same step — no score for the player.
- **Shooter** (`shooterAi.ts`): approaches until inside its attack range (320 px), holds, and fires (per-shooter sim-time cooldown) once aimed within 0.1 rad. Enemy shots reuse the same projectile system with `owner: 'enemy'`.

Rotation uses shortest-arc steering with no overshoot. Both types respect island/ship collisions through the shared resolver.

## 7. Spawn system

A sim-time timer spawns an enemy every configured interval (first spawn after one full interval). Position is rejection-sampled from the session RNG with a fixed consumption order; candidates must clear islands, walls and a **derived** safe distance from the player (`max(chaserSpeed × 2 s, shooterRange) + margin` ≈ 380 px — no magic "100 px"). After 40 failed attempts the interval is skipped (counted, never thrown). Type selection is weighted by config, with a guarantee that both types appear during a default match.

## 8. Match lifecycle

`ready → running ⇄ paused → ended`, destroyable from any state (idempotent). End reasons: `player-death` or `time-expired` (checked at the top of a step, so time deterministically beats death on the boundary step). Ending freezes movement, attacks, damage, spawns and scoring. Pause is manual (P / HUD button) or automatic (window blur, hidden tab); regaining focus never auto-resumes; pausing clears intents so held keys die with it. Restart ("Play Again", only after ending) builds a brand-new session with a new seed. Leaving the game screen or reloading **abandons** the match: the session is destroyed without ending and produces no result.

## 9. Game → React bridge

`bridge/hudStore.ts` + `useSyncExternalStore`. The store is updated every rendered frame but only **emits** when a displayed value changes (whole second, HP, score, lifecycle, end reason) — React renders ~1×/s during gameplay, never per frame. It is deliberately not a generic event bus.

## 10. Local persistence

Thin guarded adapters in `persistence/` — the core never touches storage:

- `gameOptionsStorage` — versioned options (`pirate-battle:options`) with field-by-field validation fallback.
- `lastMatchStorage` — the last **completed** result (`pirate-battle:last-match-result`), written exactly once per ended session *before* React can observe the `ended` state; abandoned matches never overwrite it.

Each match snapshots `buildGameConfigFromOptions(loadGameOptions())` at start (deep-frozen), so mid-match option changes only affect the next match. Blocked/corrupted storage can never break gameplay.

## 11. Ranking / history integration

Contracts in `api/types.ts` (`MatchRecord`, `RankingEntry`, `PaginatedResponse<T>`); Axios client in `api/client.ts`; TanStack Query hooks in `api/queries.ts` (query keys `['ranking', fingerprint, page]`, `['history', playerId, page]`, `keepPreviousData` for pagination). When a match ends, `GameCanvas` builds a `MatchRecord` from the stored result — `matchId = playerId + completedAt`, deterministic — and fires the registration mutation once; success invalidates both boards. Registration is fire-and-forget: the Result screen shows Saving/Saved/Failed + Retry, and Play Again / Main Menu are never blocked by the network. Idempotency is double-ended: the deterministic id plus the mock server returning the existing record for a known id. The local player is a fixed identity (`local-player` / "Player"); there is no auth.

## 12. MSW architecture

`mocks/handlers.ts` defines the three endpoints once, shared by development, Playwright and the production build (the worker starts unconditionally in `main.tsx`, before first render, with `onUnhandledFrame: 'bypass'`). `mocks/mockDb.ts` is the data layer: pure, unit-tested list/rank/paginate/upsert helpers over a `localStorage`-persisted record list seeded from fixtures. Scenarios (`success` / `empty` / `error` / `slow`) are read per request from `localStorage`, selectable from the Main Menu and writable by tests; "Reset mock data" restores the initial state.

## 13. Resource cleanup

`createPixiStage.destroy()` tears down everything a mount owns: window/document listeners, keyboard adapter (emitting empty intents), test API, ticker callback, session (`destroy()`), scene graph and the `Application` (canvas removed; shared textures stay in the Pixi `Assets` cache for the next mount). The flow is StrictMode-safe (an orphan `Application` from a cancelled init is destroyed, not attached), and E2E asserts that repeated menu→game→menu cycles leave zero canvases and no duplicated listeners.

## 14. Determinism and testing strategy

The dev-only `window.__gameTest` API exposes a read-only snapshot, pause/resume, validated spawn/remove/drive, `restart(seed)` and `advanceTime(seconds)` — a real-clock fast-forward in sub-clamp chunks, so "finish a 120 s match" in a test runs every rule of a real match. E2E drives real keyboard/pointer input and asserts via cumulative simulation counters (shots, impacts, spawns) rather than racing short-lived entities. Visual baselines are taken only in deterministic states (paused/settled, timers masked).

## 15. Known tradeoffs and limitations

- Advanced network-failure scenarios (out-of-order, variable latency, post-POST timeout recovery, 4xx/5xx matrix) are not simulated; failed registrations are retryable manually but not queued across refresh.
- A Chaser can stall if the player sits exactly on the island-center line behind it (degenerate, breaks on any movement) — documented instead of adding steering.
- Ship sprites may visually overlap island coast art (collision radius is intentionally forgiving vs. the drawn coastline).
- The Pixi-driven main bundle exceeds Vite's 500 kB chunk warning; code-splitting the game screen was left out of scope.
- Balancing values (speeds, damage, ranges) live entirely in `gameConfig.ts`; changing them requires no system changes but no in-game tuning UI exists beyond the two exposed options.
- No sound, and the menu boards use toggle buttons rather than the full ARIA tabs pattern.
