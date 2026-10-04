import healthFillAmberUrl from '../../assets/png/default/ui/hud/health_fill_amber.png'
import healthFillGreenUrl from '../../assets/png/default/ui/hud/health_fill_green.png'
import healthFillRedUrl from '../../assets/png/default/ui/hud/health_fill_red.png'
import healthFrameUrl from '../../assets/png/default/ui/hud/health_frame.png'
import iconHeartUrl from '../../assets/png/default/ui/hud/icon_heart.png'
import iconScoreUrl from '../../assets/png/default/ui/hud/icon_score.png'
import iconTimeUrl from '../../assets/png/default/ui/hud/icon_time.png'
import iconPauseUrl from '../../assets/png/default/ui/controls/icon_pause.png'
import type { HudSnapshot } from '../bridge/hudStore'
import { formatRemainingTime } from './format'

interface MatchHudProps {
  hud: HudSnapshot
  onPause: () => void
}

/**
 * The fixed match HUD (official Pirate Battle HUD art): health panel on
 * the left, timer + score + pause on the right — mirroring the reference
 * screenshots. Values arrive through the discrete hudStore bridge, so
 * this component re-renders at ~1/s in a calm match, never per frame.
 */
export default function MatchHud({ hud, onPause }: MatchHudProps) {
  const ratio = hud.maxHealth > 0 ? hud.health / hud.maxHealth : 0
  const fillUrl = ratio > 0.5 ? healthFillGreenUrl : ratio > 0.25 ? healthFillAmberUrl : healthFillRedUrl
  const lowTime = hud.lifecycle === 'running' && hud.remainingSeconds <= 10

  return (
    <section className="match-hud" aria-label="Match status">
      <div className="hud-health" aria-label={`Health: ${hud.health} of ${hud.maxHealth}`}>
        <img className="hud-health__heart" src={iconHeartUrl} alt="" />
        <span className="hud-health__bar" style={{ backgroundImage: `url(${healthFrameUrl})` }}>
          <span className="hud-health__clip" style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }}>
            <span className="hud-health__fill" style={{ backgroundImage: `url(${fillUrl})` }} />
          </span>
          <span className="hud-health__value" aria-hidden="true">
            {hud.health} / {hud.maxHealth}
          </span>
        </span>
      </div>

      <div className="hud-right">
        <div
          className={`hud-counter${lowTime ? ' hud-counter--low-time' : ''}`}
          aria-label={`Time remaining: ${formatRemainingTime(hud.remainingSeconds)}`}
        >
          <img src={iconTimeUrl} alt="" />
          <span>{formatRemainingTime(hud.remainingSeconds)}</span>
        </div>
        <div className="hud-counter" aria-label={`Score: ${hud.score}`}>
          <img src={iconScoreUrl} alt="" />
          <span>{hud.score}</span>
        </div>
        {hud.lifecycle === 'running' && (
          <button type="button" className="hud-round-button" onClick={onPause} aria-label="Pause (P)">
            <img src={iconPauseUrl} alt="" />
          </button>
        )}
      </div>
    </section>
  )
}
