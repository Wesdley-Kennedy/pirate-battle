import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import iconFireFrontUrl from '../../../assets/png/default/ui/controls/icon_fire_front.png'
import iconFireLeftUrl from '../../../assets/png/default/ui/controls/icon_fire_left.png'
import iconFireRightUrl from '../../../assets/png/default/ui/controls/icon_fire_right.png'
import iconForwardUrl from '../../../assets/png/default/ui/controls/icon_forward.png'
import iconPauseUrl from '../../../assets/png/default/ui/controls/icon_pause.png'
import iconTurnLeftUrl from '../../../assets/png/default/ui/controls/icon_turn_left.png'
import iconTurnRightUrl from '../../../assets/png/default/ui/controls/icon_turn_right.png'
import titleUrl from '../../../assets/png/default/ui/menu/title_pirate_battle.png'
import {
  getMockScenario,
  resetMockData,
  setMockScenario,
  type MockScenario,
} from '../../mocks/mockDb'
import { HistoryPanel, RankingPanel } from '../menu/BoardPanels'

interface MainMenuProps {
  onPlay: () => void
  onOptions: () => void
}

const CONTROLS: { icon: string; keys: string; action: string }[] = [
  { icon: iconForwardUrl, keys: 'W / ↑', action: 'Move forward' },
  { icon: iconTurnLeftUrl, keys: 'A / ←', action: 'Turn left' },
  { icon: iconTurnRightUrl, keys: 'D / →', action: 'Turn right' },
  { icon: iconFireFrontUrl, keys: 'Space', action: 'Front cannon' },
  { icon: iconFireLeftUrl, keys: 'Q', action: 'Left broadside' },
  { icon: iconFireRightUrl, keys: 'E', action: 'Right broadside' },
  { icon: iconPauseUrl, keys: 'P', action: 'Pause / resume' },
]

type MenuTab = 'ranking' | 'history'

function toScenario(value: string): MockScenario {
  return value === 'empty' || value === 'error' || value === 'slow' ? value : 'success'
}

/**
 * Demo/dev selector for the MSW scenarios, plus a reset back to the
 * fixture data. Required by the challenge: scenarios must be selectable
 * and reproducible, including in the published build.
 */
function NetworkScenarioControls() {
  const queryClient = useQueryClient()
  const [scenario, setScenarioState] = useState<MockScenario>(getMockScenario)

  function applyScenario(next: MockScenario): void {
    setMockScenario(next)
    setScenarioState(next)
    void queryClient.invalidateQueries()
  }

  function handleReset(): void {
    resetMockData()
    setScenarioState('success')
    void queryClient.invalidateQueries()
  }

  return (
    <div className="network-controls">
      <label htmlFor="network-scenario">Network (demo)</label>
      <select
        id="network-scenario"
        value={scenario}
        onChange={(event) => applyScenario(toScenario(event.target.value))}
      >
        <option value="success">Success</option>
        <option value="empty">Empty</option>
        <option value="error">Error</option>
        <option value="slow">Slow</option>
      </select>
      <button type="button" onClick={handleReset}>
        Reset mock data
      </button>
    </div>
  )
}

/**
 * Main menu: official title art, Play/Options, compact controls and the
 * Ranking / Match History boards, fed by the mocked REST API through
 * Axios + TanStack Query + MSW.
 */
export default function MainMenu({ onPlay, onOptions }: MainMenuProps) {
  const [tab, setTab] = useState<MenuTab>('ranking')

  return (
    <div className="menu-screen">
      <h1 className="menu-screen__title">
        <img src={titleUrl} alt="Pirate Battle" />
      </h1>

      <div className="pirate-panel menu-screen__panel">
        <button type="button" className="pirate-button" onClick={onPlay}>
          Play
        </button>
        <button type="button" className="pirate-button pirate-button--secondary" onClick={onOptions}>
          Options
        </button>
      </div>

      <section className="pirate-panel menu-screen__controls" aria-label="Controls">
        <h2>Controls</h2>
        <ul>
          {CONTROLS.map((entry) => (
            <li key={entry.action}>
              <img src={entry.icon} alt="" />
              <kbd>{entry.keys}</kbd>
              <span>{entry.action}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="pirate-panel menu-screen__boards" aria-label="Leaderboards">
        <div className="menu-tabs">
          <button
            type="button"
            className="menu-tabs__button"
            aria-pressed={tab === 'ranking'}
            onClick={() => setTab('ranking')}
          >
            Ranking
          </button>
          <button
            type="button"
            className="menu-tabs__button"
            aria-pressed={tab === 'history'}
            onClick={() => setTab('history')}
          >
            Match History
          </button>
        </div>
        <div className="menu-tabs__content" aria-label={tab === 'ranking' ? 'Ranking' : 'Match History'}>
          {tab === 'ranking' ? <RankingPanel /> : <HistoryPanel />}
        </div>
        <NetworkScenarioControls />
      </section>
    </div>
  )
}
