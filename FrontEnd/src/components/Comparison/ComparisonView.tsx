import type { ComparisonBaseline, ComparisonPair } from '../../types/simulation'
import type { VisualizationMode } from '../SimulationViewport'
import type { SceneLayout } from '../ThreeD/Road3D'
import { SimulationViewport } from '../SimulationViewport'
import type { CameraCommand } from '../../engine/CameraController'
import { SplitMapView } from './SplitMapView'

type ComparisonViewProps = {
  pair: ComparisonPair | null
  baseline: ComparisonBaseline
  visualization: VisualizationMode
  layout: SceneLayout
  onTileError?: (message: string) => void
  overlay?: boolean
  effectMode?: 'idle' | 'event' | 'scan' | 'all'
  cameraCommand?: CameraCommand | null
  onManualCamera?: () => void
}

const BASELINE_LABELS: Record<ComparisonBaseline, string> = {
  broadcast: '全广播基线',
  distance: '距离基线',
  urgency: '紧急度基线',
}

export function ComparisonView({ pair, baseline, visualization, layout, onTileError, overlay = false,
  effectMode = 'all', cameraCommand = null, onManualCamera }: ComparisonViewProps) {
  if (!pair) {
    return (
      <section className="comparison-empty" aria-live="polite">
        <p className="eyebrow">SYNCHRONIZED COMPARISON</p>
        <h2>等待同一时间戳的对比数据</h2>
        <p>点击“运行仿真”后，界面会在 AI 与基线状态同时到达时一次更新两侧地图。</p>
      </section>
    )
  }

  if (overlay) {
    return (
      <section className="comparison-overlay" aria-label="AI与传统方法消息叠加对比">
        <div className="comparison-overlay__legend">
          <span><i className="overlay-dot overlay-dot--ai" />AI精准传播</span>
          <span><i className="overlay-dot overlay-dot--baseline" />传统方法广播</span>
        </div>
        <SimulationViewport visualization={visualization} layout={layout}
          title="AI与传统方法叠加对比" eyebrow="OVERLAY COMPARISON"
          vehicles={pair.ai.vehicles} events={pair.ai.events} messages={pair.ai.messages}
          secondaryMessages={pair.baseline.messages} animationChannel="comparison-ai"
          secondaryAnimationChannel="comparison-baseline"
          attentionWeights={pair.ai.attention_weights ?? []}
          candidateIds={pair.ai.decision.candidate_vehicles?.map((vehicle) => vehicle.id) ?? []}
          effectMode={effectMode} cameraCommand={cameraCommand} onManualCamera={onManualCamera}
          onTileError={onTileError} />
      </section>
    )
  }

  return (
    <section className="comparison-view" aria-label="AI与基线同步对比">
      <SplitMapView label="AI（PPO）" tone="ai" state={pair.ai} visualization={visualization}
        layout={layout} onTileError={onTileError} />
      <SplitMapView label={BASELINE_LABELS[baseline]} tone="baseline" state={pair.baseline}
        visualization={visualization} layout={layout} onTileError={onTileError} />
    </section>
  )
}
