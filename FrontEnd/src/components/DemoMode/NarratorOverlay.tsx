import { Radio } from 'lucide-react'

import type { ComparisonPair, StateUpdateMessage } from '../../types/simulation'
import type { DemoScenario } from './DemoScenarios'
import type { NarrativeStageConfig } from './NarrativeStages'

type NarratorOverlayProps = {
  scenario: DemoScenario | undefined
  state: StateUpdateMessage | null
  comparison: ComparisonPair | null
  stage: NarrativeStageConfig
  event?: StateUpdateMessage['events'][number]
}

function narrationFor(state: StateUpdateMessage | null, comparison: ComparisonPair | null): string {
  if (!state) return '准备加载场景；事件、AI决策和消息传播将按时间顺序展示。'
  if (state.events.length) {
    const delivered = state.messages.filter((message) => message.status === 'success').length
    const timedOut = state.messages.length - delivered
    const selected = state.decision.selected_receivers.length
    if (comparison) {
      return `事件已触发。AI选择${selected}辆车，基线选择${comparison.baseline.decision.selected_receivers.length}辆；当前成功${delivered}条、超时${timedOut}条。`
    }
    return `事件已触发。AI选择${selected}辆关键车辆；当前成功送达${delivered}条，超时${timedOut}条。`
  }
  return `当前有${state.vehicles.length}辆活动车辆，系统正在等待事件并持续更新网络状态。`
}

export function NarratorOverlay({ scenario, state, comparison, stage, event }: NarratorOverlayProps) {
  const candidates = state?.decision.candidate_vehicles?.length ?? 0
  const selected = state?.decision.selected_receivers.length ?? 0
  const inference = state?.decision.inference_time_ms
  return (
    <aside className="narrator-overlay" aria-live="polite" aria-atomic="true">
      <div className="narrative-stage-title"><Radio size={20} aria-hidden="true" /><strong>{stage.title}</strong></div>
      <div className="narrative-copy"><span>演示解说 · {scenario?.title ?? '准备中'}</span><p>{narrationFor(state, comparison)}</p></div>
      <div className="narrative-facts">
        {event && <span>紧急制动 · severity {event.severity.toFixed(1)}</span>}
        {candidates > 0 && <span>分析{candidates}辆候选车 · 选定{selected}辆{inference === undefined ? '' : ` · ${inference.toFixed(1)}ms`}</span>}
      </div>
      <dl className="narrative-metrics">
        <div><dt>时延</dt><dd>{state?.metrics.avg_delay_ms.toFixed(1) ?? '—'} ms</dd></div>
        <div><dt>送达</dt><dd>{state ? `${(state.metrics.delivery_rate * 100).toFixed(0)}%` : '—'}</dd></div>
        <div><dt>开销</dt><dd>{state?.metrics.comm_overhead.toFixed(2) ?? '—'}x</dd></div>
      </dl>
    </aside>
  )
}
