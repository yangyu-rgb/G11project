import { Activity, FlaskConical, Presentation, RadioTower } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'

import { DemoHud, SelectionPanel } from './components/Presentation/PresentationOverlay'
import { presentationCueAt } from './components/Presentation/presentationTimeline'
import {
  buildHighwayPresentationScenario,
  recommendedIncidentVehicleId,
  type PresentationDensity,
} from './components/SceneEditor/PresetScenes'
import { editorVehicleToSimulation } from './components/SceneEditor/sceneTypes'
import { usePresentationDemo } from './hooks/usePresentationDemo'
import { useDemoResults } from './hooks/useDemoResults'
import { useLiveComparisonTelemetry } from './hooks/useLiveComparisonTelemetry'
import type { ValidationTask } from './components/Research/ResearchWorkspace'
import {
  DEFAULT_PRESENTATION_ENVIRONMENT,
  type PresentationEnvironment,
} from './components/ThreeD/environmentPresets'

const Scene3D = lazy(() => import('./components/ThreeD/Scene3D').then((module) => ({
  default: module.Scene3D,
})))
const ComparisonScene3D = lazy(() => import('./components/ThreeD/ComparisonScene3D').then((module) => ({
  default: module.ComparisonScene3D,
})))
const ResearchWorkspace = lazy(() => import('./components/Research/ResearchWorkspace').then((module) => ({
  default: module.ResearchWorkspace,
})))

type HealthResponse = { status: string; service: string }

export default function App() {
  const [health, setHealth] = useState('正在连接后端')
  const [workspace, setWorkspace] = useState<'presentation' | 'research'>('presentation')
  const [validationTask, setValidationTask] = useState<ValidationTask>('decision')
  const [density, setDensity] = useState<PresentationDensity>('dense')
  const [environmentPreset, setEnvironmentPreset] = useState<PresentationEnvironment>(
    DEFAULT_PRESENTATION_ENVIRONMENT,
  )
  const presentationScenario = useMemo(() => buildHighwayPresentationScenario(density), [density])
  const demo = usePresentationDemo(presentationScenario)
  const demoResults = useDemoResults()
  const replayProgress = presentationCueAt(demo.elapsedMs).linkRevealProgress
  const live = useLiveComparisonTelemetry(
    demo.pairs, demo.selectedVehicleId, demo.evidence, replayProgress,
  )
  const templateVehicles = useMemo(
    () => presentationScenario.vehicles.map(editorVehicleToSimulation),
    [presentationScenario],
  )

  useEffect(() => {
    fetch('/api/v1/health')
      .then((response) => response.ok ? response.json() as Promise<HealthResponse> : Promise.reject())
      .then((data) => setHealth(`${data.service} · ${data.status}`))
      .catch(() => setHealth('后端尚未连接'))
  }, [])

  const evidence = demo.evidence
  const presentationActive = demo.phase === 'exploring' || demo.phase === 'playing'
    || demo.phase === 'paused' || demo.phase === 'complete'
  const currentAI = live.pair?.ai ?? evidence?.ai
  const vehicles = presentationActive ? currentAI?.vehicles ?? templateVehicles : templateVehicles
  const events = presentationActive && demo.stage !== 'normal' ? currentAI?.events ?? [] : []
  const messages = demo.stage === 'comparison' ? currentAI?.messages ?? [] : []
  const candidateIds = presentationActive && demo.stage === 'comparison'
    ? currentAI?.decision.candidate_vehicles?.map((vehicle) => vehicle.id) ?? [] : []
  const notifiedIds = presentationActive && demo.stage === 'comparison'
    ? currentAI?.decision.selected_receivers ?? [] : []
  const priorityByVehicle = useMemo(() => {
    const priorities: Record<string, number> = {}
    const corridor = currentAI?.decision.action_mode === 'directional_corridor'
    if (!corridor) {
      for (const attention of currentAI?.attention_weights ?? []) {
        priorities[attention.vehicle_id] = Math.max(priorities[attention.vehicle_id] ?? 0, attention.weight)
      }
    }
    for (const candidate of currentAI?.decision.candidate_vehicles ?? []) {
      const riskDistance = candidate.longitudinal_m ?? candidate.distance_m
      priorities[candidate.id] ??= 1 / Math.max(1, riskDistance)
    }
    return priorities
  }, [currentAI])
  const channel = 'comparison-ai' as const
  const selectingVehicle = demo.phase === 'selecting'
  const recommendedVehicleId = recommendedIncidentVehicleId(presentationScenario)
  const connectionLabel = demo.phase === 'complete' ? '结果已就绪'
    : demo.phase === 'selecting' ? '待机' : demo.connectionStatus
  const comparisonVisible = presentationActive && Boolean(evidence)
    && (demo.stage === 'comparison' || demo.stage === 'summary')
  const comparisonPair = evidence
  const openValidation = (task: ValidationTask = 'decision') => {
    if (demo.phase === 'playing') demo.togglePause()
    setValidationTask(task)
    setWorkspace('research')
  }

  return (
    <main className={`presentation-app presentation-app--${workspace}`}>
      <header className="presentation-header">
        <div className="brand-lockup">
          <RadioTower aria-hidden="true" />
          <div>
            <p>6G自主驾驶网络</p>
            <h1>AI赋能的选择性V2X通信</h1>
          </div>
        </div>
        <nav className="workspace-switch" aria-label="工作模式">
          <button type="button" className={workspace === 'presentation' ? 'is-active' : ''}
            onClick={() => setWorkspace('presentation')}>
            <Presentation aria-hidden="true" />答辩演示
          </button>
          <button type="button" className={workspace === 'research' ? 'is-active' : ''}
            onClick={() => openValidation('decision')}>
            <FlaskConical aria-hidden="true" />验证实验室
          </button>
        </nav>
        <div className="system-status" aria-live="polite">
          <Activity aria-hidden="true" />
          <span>{health}</span>
          <b>{connectionLabel}</b>
        </div>
      </header>

      {workspace === 'presentation' ? <section className="scene-shell" aria-label="V2X三维演示工作区">
        {selectingVehicle || demo.phase === 'preparing' ? <div
          className={`setup-stage-backdrop setup-stage-backdrop--${environmentPreset}`}
          aria-hidden="true"><i /><i /><i /></div>
          : <Suspense fallback={<div className="scene-loading" role="status">正在加载3D场景…</div>}>{comparisonVisible && comparisonPair && demo.selectedVehicleId
          ? <ComparisonScene3D pair={comparisonPair} accidentVehicleId={demo.selectedVehicleId}
            selectedVehicleId={demo.inspectedVehicleId} priorityByVehicle={priorityByVehicle}
            elapsedMs={demo.elapsedMs} stage={demo.stage}
            baseline={demo.selectedBaseline} environmentPreset={environmentPreset}
            onVehicleSelect={demo.setInspectedVehicleId} />
          : <Scene3D
          vehicles={vehicles}
          events={events}
          messages={messages}
          animationChannel={channel}
          messageTone="ai"
          candidateIds={candidateIds}
          notifiedIds={notifiedIds}
          selectedVehicleId={presentationActive ? demo.inspectedVehicleId : demo.selectedVehicleId}
          accidentVehicleId={presentationActive ? demo.selectedVehicleId : null}
          stage={demo.stage}
          elapsedMs={demo.elapsedMs}
          corridorRadiusM={currentAI?.decision.corridor_radius_m}
          corridorLaneScope={currentAI?.decision.corridor_lane_scope}
          priorityByVehicle={priorityByVehicle}
          environmentPreset={environmentPreset}
          interactive={selectingVehicle || presentationActive}
          onVehicleSelect={selectingVehicle ? demo.setSelectedVehicleId
            : presentationActive ? demo.setInspectedVehicleId : undefined}
        />}</Suspense>}

        {(demo.phase === 'selecting' || demo.phase === 'preparing') && <SelectionPanel
          vehicles={templateVehicles}
          selectedVehicleId={demo.selectedVehicleId}
          recommendedVehicleId={recommendedVehicleId}
          preparing={demo.phase === 'preparing'}
          density={density}
          environmentPreset={environmentPreset}
          modelEligible={demo.modelStatus?.eligible ?? false}
          modelReason={demo.modelStatus?.reason ?? null}
          modelHash={demoResults.results?.provenance?.model_sha256 ?? null}
          notice={demo.notice}
          baseline={demo.selectedBaseline}
          onDensityChange={setDensity}
          onEnvironmentChange={setEnvironmentPreset}
          onVehicleSelect={demo.setSelectedVehicleId}
          onBaselineChange={demo.setSelectedBaseline}
          onStart={() => void demo.start()}
        />}

        {demo.phase === 'preparing' && <div className="preparing-overlay" role="status">
          <span className="loading-orbit" aria-hidden="true" />
          <strong>正在计算正式AI与{demo.selectedBaseline === 'broadcast' ? '全量广播'
            : demo.selectedBaseline === 'distance' ? '固定范围' : '紧急度调度'}的同步结果</strong>
          <small>同一场景、同一随机种子、同一仿真时间戳</small>
        </div>}

        {presentationActive && demo.selectedVehicleId && <DemoHud
          phase={demo.phase}
          source={demo.source}
          stage={demo.stage}
          elapsedMs={demo.elapsedMs}
          evidence={evidence}
          accidentVehicleId={demo.selectedVehicleId}
          notice={demo.notice}
          mode={demo.mode}
          inspectedVehicleId={demo.inspectedVehicleId}
          results={demoResults.results}
          comparisonMode={comparisonVisible}
          telemetry={live.telemetry}
          baseline={demo.selectedBaseline}
          environmentPreset={environmentPreset}
          onTogglePause={demo.togglePause}
          onReplay={demo.replay}
          onAutoplay={demo.startAutoplay}
          onSeek={demo.seek}
          onReset={demo.reset}
          onOpenValidation={() => openValidation('decision')}
        />}
      </section> : <Suspense fallback={<div className="scene-loading research-loading" role="status">正在加载验证实验室…</div>}>
        <ResearchWorkspace scenario={demo.scenario} presentationPairs={demo.pairs}
          presentationSource={demo.source} modelEligible={demo.modelStatus?.eligible ?? false}
          modelReason={demo.modelStatus?.reason ?? null} initialTask={validationTask}
          environmentPreset={environmentPreset} />
      </Suspense>}
    </main>
  )
}
