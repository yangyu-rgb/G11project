import { Radio } from 'lucide-react'

import type { ComparisonPair, StateUpdateMessage } from '../../types/simulation'
import type { DemoScenario } from './DemoScenarios'

type NarratorOverlayProps = {
  scenario: DemoScenario | undefined
  state: StateUpdateMessage | null
  comparison: ComparisonPair | null
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

export function NarratorOverlay({ scenario, state, comparison }: NarratorOverlayProps) {
  return (
    <aside className="narrator-overlay" aria-live="polite">
      <Radio size={20} aria-hidden="true" />
      <div><span>演示解说 · {scenario?.title ?? '准备中'}</span><p>{narrationFor(state, comparison)}</p></div>
    </aside>
  )
}
