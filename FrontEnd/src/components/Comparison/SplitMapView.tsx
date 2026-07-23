import { MapView } from '../MapView/MapView'
import type { StateUpdateMessage } from '../../types/simulation'

type SplitMapViewProps = {
  label: string
  tone: 'ai' | 'baseline'
  state: StateUpdateMessage
}

export function SplitMapView({ label, tone, state }: SplitMapViewProps) {
  return (
    <article className={`comparison-pane comparison-pane--${tone}`}>
      <div className="comparison-summary" aria-label={`${label} 当前指标`}>
        <div>
          <p className="eyebrow">{tone === 'ai' ? 'PPO POLICY' : 'BASELINE'}</p>
          <h3>{label}</h3>
        </div>
        <dl>
          <div><dt>时延</dt><dd>{state.metrics.avg_delay_ms.toFixed(1)} ms</dd></div>
          <div><dt>覆盖率</dt><dd>{(state.metrics.delivery_rate * 100).toFixed(1)}%</dd></div>
          <div><dt>开销</dt><dd>{state.metrics.comm_overhead.toFixed(2)}x</dd></div>
          <div><dt>消息</dt><dd>{state.messages.length}</dd></div>
        </dl>
      </div>
      <MapView
        headingId={`comparison-${tone}-map-heading`}
        eyebrow={tone === 'ai' ? 'AI LIVE MAP' : 'BASELINE LIVE MAP'}
        title={`${label}通信态势`}
        vehicles={state.vehicles}
        events={state.events}
        messages={state.messages}
        attentionWeights={state.attention_weights ?? []}
      />
    </article>
  )
}
