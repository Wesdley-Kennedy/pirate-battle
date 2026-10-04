# Pirate Battle

A top-down 2D naval shooter built for the React & PixiJS developer challenge: steer a pirate ship between islands, sink Chasers and Shooters, and score points before the clock — or your hull — runs out.

The original challenge brief asked for a single-player, browser-only game with React menus, a PixiJS arena, locally persisted options/results, and a mocked ranking/history REST API (MSW) consumed with Axios + TanStack Query, all covered by Playwright E2E and visual regression tests.

## Live Demo

> _Deploy pending — add the Vercel URL here after `vercel deploy` (see [Deployment](#deployment))._

## Stack

| Responsibility | Technology |
| --- | --- |
| UI, menus, HUD overlays | React 19 |
| Language | TypeScript (strict, `noUncheckedIndexedAccess`) |
| Game rendering | PixiJS 8 |
| Ranking / history server state | TanStack Query 5 |
| HTTP client | Axios |
| API mocking (dev, tests **and** the published build) | MSW 3 |
| E2E + visual regression | Playwright |
| Build / unit tests | Vite / Vitest |

## Setup

```bash
npm install
npm run dev        # http://localhost:5173
```

No environment variables are required. The ranking/history API is fully simulated by MSW (a service worker served from `public/mockServiceWorker.js`), so the app works from a clean checkout with no services.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck (`tsc -b`) + production build to `dist/` |
| `npm run preview` | Serves the production build locally |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript project check |
| `npm run test:unit` | Vitest unit suite |
| `npm run test:e2e` | Playwright E2E + visual regression (starts the dev server itself) |

Playwright produces an HTML report (`npx playwright show-report`) and keeps traces for failed tests.

## Controls

**Desktop (keyboard):**

| Key | Action |
| --- | --- |
| `W` / `↑` | Move forward |
| `A` / `←`, `D` / `→` | Turn left / right |
| `Space` | Front cannon (1 projectile) |
| `Q` / `E` | Left / right broadside (3 parallel projectiles) |
| `P` | Pause / resume |

**Touch (shown automatically on touch devices):** on-screen pads — movement/turning on the left, the three attacks on the right. Every pad tracks its own pointer, so moving, turning and firing work simultaneously (multi-touch). Landscape is the intended gameplay orientation; portrait shows a rotate hint but blocks nothing. Keyboard and touch are just two adapters feeding the same simulation intents.

Losing window focus (or hiding the tab) auto-pauses; resuming always requires an explicit action. Held inputs never survive a pause.

## Gameplay configuration

All gameplay parameters (speeds, damage, cooldowns, ranges, enemy distribution…) live in one typed config, `src/game/config/gameConfig.ts`. The Options screen exposes the two player-facing ones:

| Option | Range | Default |
| --- | --- | --- |
| Game session time | 60–180 s | 120 s |
| Enemy spawn time | 1–30 s | 5 s |

Options are validated, persisted in `localStorage` and survive refresh. Each match snapshots the configuration when it starts; changes apply to the next match only.

## Architecture summary

React owns screens/HUD; PixiJS owns the arena; the simulation (`GameSession`) is pure TypeScript with a fixed 60 Hz timestep, a seeded RNG and an injectable clock — fully deterministic and frame-rate independent. A discrete store bridges game → React at ~1 render/s (never per frame). Full details, including the ranking/history integration and the MSW design, are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Ranking & match history

The Main Menu tabs consume `GET /api/ranking`, `GET /api/history` and `POST /api/matches` through Axios + TanStack Query. A completed match is registered exactly once: the `matchId` is deterministic (player + completion instant) and the mock server treats re-sends as idempotent, so retries and double clicks can never duplicate a record. The ranking compares only matches played under the same options (fingerprint: session time + spawn interval), ordered by score with the earlier completion as a deterministic tiebreak; other players are fixtures. Both lists are paginated (5 per page).

## Network mocks (MSW)

Mocks run in development, in tests **and in the published build**. Confirmed registrations persist in `localStorage`, so they survive refresh.

**Selecting a scenario:** use the **Network (demo)** selector at the bottom of the Main Menu boards panel:

- **Success** — fixture + registered data (default)
- **Empty** — lists come back empty
- **Error** — every API call fails with 503 (use it to reproduce the "Registration failed → Retry" flow on the Result screen)
- **Slow** — success after ~1.5 s (exercises the loading states)

**Resetting:** the **Reset mock data** button restores the fixture data and the Success scenario. Tests select scenarios by writing `pirate-battle:mock-scenario` directly.

## Testing

- **Unit (Vitest):** simulation core — lifecycle, fixed timestep, movement, collisions, weapons, projectiles, AI, spawning, damage/score — plus persistence adapters and the mock data layer.
- **E2E (Playwright, Chromium):** real-input gameplay (keyboard and touch), arena/collision behavior, pause/focus semantics, match end/restart, options, screen navigation, ranking/history including error scenarios, registration retry and refresh persistence. Deterministic via seeded RNG and a dev-only clock fast-forward that still executes every simulation rule.
- **Visual regression:** committed baselines for the menu (wide + narrow), options, arena, paused state and result overlay.

## Known limitations

Being explicit about what the original brief asks for that this submission does **not** fully cover:

- **Advanced network scenarios** — out-of-order/delayed responses, variable latency, request timeouts after `POST` with automatic recovery, and the broader 4xx/5xx matrix are not simulated; only success / empty / error (503) / fixed slow are.
- **Pending registration recovery** — a failed registration offers a manual Retry on the Result screen, but is not queued across refresh or navigation; leaving the Result screen drops the pending attempt (the local last-result persistence is unaffected).
- **Mobile matrix** — touch controls are verified through Playwright's Chromium touch emulation, not on a physical-device/browser matrix.
- **Performance evidence** — no formal 3-minute profiling report (FPS/p95/entity counts) or 5-cycle memory study is included; the main JS bundle also exceeds Vite's 500 kB warning (PixiJS).
- **Accessibility** — keyboard navigation, visible focus, labels and semantic match status are in place, but no full WCAG audit was performed and the menu boards use toggle buttons rather than the complete ARIA tabs pattern.
- **Sound** — the provided WAV assets are not used.
- The ranking board always shows the leaderboard for the currently saved options (by design, since only same-configuration matches are comparable).

## Deployment

The app is a pure static SPA (no URL routes), so any static host works. For Vercel:

1. Import the repository (framework preset: **Vite**; build `npm run build`, output `dist/` — autodetected).
2. No environment variables, no rewrites needed.
3. `public/mockServiceWorker.js` is copied into `dist/` automatically, so the mocked API works on the published URL — verify by opening the deployed site and checking the Ranking tab.

To verify the production build locally: `npm run build && npm run preview`.

## Assets

All art comes from the asset pack provided with the challenge (`assets/`), consumed directly via Vite imports — no files were moved or converted.
