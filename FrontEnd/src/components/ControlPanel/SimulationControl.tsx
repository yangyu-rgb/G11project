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
          <h2 id="control-heading">仿真控制</h2>
        </div>
        <span className={`run-state run-state--${playing ? 'playing' : 'paused'}`}>
          {completed ? '本轮已完成' : playing ? '正在播放' : '已暂停'}
        </span>
      </div>

      <div className="control-actions">
        <button type="button" className="primary-button" onClick={onRun} disabled={status === 'connecting'}>
          {connected ? '重新运行' : status === 'connecting' ? '正在连接…' : '运行仿真'}
        </button>
        <button type="button" onClick={() => onControl('play')} disabled={!connected || playing}>
          继续
        </button>
        <button type="button" onClick={() => onControl('pause')} disabled={!connected || !playing}>
          暂停
        </button>
        <button type="button" onClick={() => onControl('reset')} disabled={!connected}>
          重置
        </button>
      </div>

      <div className="speed-control" aria-label="仿真速度">
        <span>倍速</span>
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
        <span>PPO优先级：<strong>{decision?.priority ?? '—'}</strong></span>
        <span>选中接收者：<strong>{decision?.selected_receivers.length ?? 0}</strong></span>
        <span>带宽分配：<strong>{decision ? decision.bandwidth_allocation.map((value) => value.toFixed(2)).join(' / ') || '—' : '—'}</strong></span>
      </div>
    </section>
  )
}
