import { useState } from 'react'
import GameCanvas from './ui/GameCanvas'
import MainMenu from './ui/screens/MainMenu'
import OptionsScreen from './ui/screens/OptionsScreen'

type Screen = 'menu' | 'options' | 'game'

/**
 * Screen flow: menu ⇄ options, menu → game → menu. Plain state — three
 * screens do not justify a router. Leaving the game screen unmounts the
 * whole Pixi stage (session destroyed = abandonment, no result saved).
 */
export default function App() {
  const [screen, setScreen] = useState<Screen>('menu')

  return (
    <main>
      {screen === 'menu' && (
        <MainMenu onPlay={() => setScreen('game')} onOptions={() => setScreen('options')} />
      )}
      {screen === 'options' && <OptionsScreen onBack={() => setScreen('menu')} />}
      {screen === 'game' && <GameCanvas onExitToMenu={() => setScreen('menu')} />}
    </main>
  )
}
