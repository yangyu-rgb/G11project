import type { ComparisonBaseline, ComparisonPair } from '../../types/simulation'
import { SplitMapView } from './SplitMapView'

type ComparisonViewProps = {
  pair: ComparisonPair | null
  baseline: ComparisonBaseline
}

const BASELINE_LABELS: Record<ComparisonBaseline, string> = {
  broadcast: '全广播基线',
  distance: '距离基线',
  urgency: '紧急度基线',
}

export function ComparisonView({ pair, baseline }: ComparisonViewProps) {
  if (!pair) {
    return (
      <section className="comparison-empty" aria-live="polite">
        <p className="eyebrow">SYNCHRONIZED COMPARISON</p>
        <h2>等待同一时间戳的对比数据</h2>
        <p>点击“运行仿真”后，界面会在 AI 与基线状态同时到达时一次更新两侧地图。</p>
      </section>
    )
  }

  return (
    <section className="comparison-view" aria-label="AI与基线同步对比">
      <SplitMapView label="AI（PPO）" tone="ai" state={pair.ai} />
      <SplitMapView label={BASELINE_LABELS[baseline]} tone="baseline" state={pair.baseline} />
    </section>
  )
}
