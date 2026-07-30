import type { ControlAction, SimulationDecision } from '../../types/simulation'
import type { WebSocketStatus } from '../../hooks/useWebSocket'

type SimulationControlProps = {
  status: WebSocketStatus
  playing: boolean
  speed: number
  decision: SimulationDecision | null
  completed: boolean
  onRun: () => void
  onControl: (action: ControlAction, speed?: number) => void
}

const SPEEDS = [0.5, 1, 2, 5]

export function SimulationControl({
  status,
  playing,
  speed,
  decision,
  completed,
  onRun,
  onControl,
}: SimulationControlProps) {
  const connected = status === 'connected'

  return (
    <section className="control-panel" aria-labelledby="control-heading">
      <div className="control-summary">
        <div>
          <p className="eyebrow">SIMULATION CONTROL</p>
          <h2 id="control-heading">Simulation Control</h2>
        </div>
        <span className={`run-state run-state--${playing ? 'playing' : 'paused'}`}>
          {completed ? 'Run complete' : playing ? 'Playing' : 'Paused'}
        </span>
      </div>

      <div className="control-actions">
        <button type="button" className="primary-button" onClick={onRun} disabled={status === 'connecting'}>
          {connected ? 'Run Again' : status === 'connecting' ? 'Connecting…' : 'Run Simulation'}
        </button>
        <button type="button" onClick={() => onControl('play')} disabled={!connected || playing}>
          Resume
        </button>
        <button type="button" onClick={() => onControl('pause')} disabled={!connected || !playing}>
          Pause
        </button>
        <button type="button" onClick={() => onControl('reset')} disabled={!connected}>
          Reset
        </button>
      </div>

      <div className="speed-control" aria-label="Simulation speed">
        <span>Speed</span>
        {SPEEDS.map((option) => (
          <button
            type="button"
            key={option}
            className={speed === option ? 'speed-button speed-button--active' : 'speed-button'}
            onClick={() => onControl('set_speed', option)}
            disabled={!connected}
          >
            {option}x
          </button>
        ))}
      </div>

      <div className="decision-summary" aria-live="polite">
        <span>PPO priority: <strong>{decision?.priority ?? '—'}</strong></span>
        <span>Selected receivers: <strong>{decision?.selected_receivers.length ?? 0}</strong></span>
        <span>Bandwidth allocation: <strong>{decision ? decision.bandwidth_allocation.map((value) => value.toFixed(2)).join(' / ') || '—' : '—'}</strong></span>
      </div>
    </section>
  )
}
