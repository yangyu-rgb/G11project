import { Activity, FlaskConical, Presentation, RadioTower } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'

import { DemoHud, SelectionPanel } from './components/Presentation/PresentationOverlay'
import { freezesEvidenceFrame } from './components/Presentation/presentationTimeline'
import {
  buildHighwayPresentationScenario,
  type PresentationDensity,
} from './components/SceneEditor/PresetScenes'
import { editorVehicleToSimulation } from './components/SceneEditor/sceneTypes'
import { usePresentationDemo } from './hooks/usePresentationDemo'

const Scene3D = lazy(() => import('./components/ThreeD/Scene3D').then((module) => ({
  default: module.Scene3D,
})))
const ResearchWorkspace = lazy(() => import('./components/Research/ResearchWorkspace').then((module) => ({
  default: module.ResearchWorkspace,
})))

type HealthResponse = { status: string; service: string }

export default function App() {
  const [health, setHealth] = useState('正在连接后端')
  const [workspace, setWorkspace] = useState<'presentation' | 'research'>('presentation')
  const [density, setDensity] = useState<PresentationDensity>('dense')
  const presentationScenario = useMemo(() => buildHighwayPresentationScenario(density), [density])
  const demo = usePresentationDemo(presentationScenario)
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
  const stageState = demo.stage === 'broadcast' ? evidence?.baseline : evidence?.ai
  const vehicles = presentationActive ? evidence?.ai.vehicles ?? templateVehicles : templateVehicles
  const events = presentationActive && demo.stage !== 'normal' ? evidence?.ai.events ?? [] : []
  const messages = demo.stage === 'broadcast' ? evidence?.baseline.messages ?? []
    : demo.stage === 'ai' ? evidence?.ai.messages ?? [] : []
  const candidateIds = presentationActive && demo.stage === 'ai'
    ? evidence?.ai.decision.candidate_vehicles?.map((vehicle) => vehicle.id) ?? [] : []
  const notifiedIds = presentationActive && (demo.stage === 'broadcast' || demo.stage === 'ai')
    ? stageState?.decision.selected_receivers ?? [] : []
  const priorityByVehicle = useMemo(() => {
    const priorities: Record<string, number> = {}
    const corridor = evidence?.ai.decision.action_mode === 'directional_corridor'
    if (!corridor) {
      for (const attention of evidence?.ai.attention_weights ?? []) {
        priorities[attention.vehicle_id] = Math.max(priorities[attention.vehicle_id] ?? 0, attention.weight)
      }
    }
    for (const candidate of evidence?.ai.decision.candidate_vehicles ?? []) {
      const riskDistance = candidate.longitudinal_m ?? candidate.distance_m
      priorities[candidate.id] ??= 1 / Math.max(1, riskDistance)
    }
    return priorities
  }, [evidence])
  const channel = demo.stage === 'broadcast' ? 'comparison-baseline' as const : 'comparison-ai' as const
  const connectionLabel = demo.phase === 'complete' ? '结果已就绪'
    : demo.phase === 'selecting' ? '待机' : demo.connectionStatus

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
            onClick={() => {
              if (demo.phase === 'playing') demo.togglePause()
              setWorkspace('research')
            }}>
            <FlaskConical aria-hidden="true" />研究实验台
          </button>
        </nav>
        <div className="system-status" aria-live="polite">
          <Activity aria-hidden="true" />
          <span>{health}</span>
          <b>{connectionLabel}</b>
        </div>
      </header>

      {workspace === 'presentation' ? <section className="scene-shell" aria-label="V2X三维演示工作区">
        <Suspense fallback={<div className="scene-loading" role="status">正在加载3D场景…</div>}><Scene3D
          vehicles={vehicles}
          events={events}
          messages={messages}
          animationChannel={channel}
          messageTone={demo.stage === 'broadcast' ? 'baseline' : 'ai'}
          candidateIds={candidateIds}
          notifiedIds={notifiedIds}
          selectedVehicleId={presentationActive ? demo.inspectedVehicleId : demo.selectedVehicleId}
          accidentVehicleId={presentationActive ? demo.selectedVehicleId : null}
          stage={demo.stage}
          elapsedMs={demo.elapsedMs}
          freezeEvidenceFrame={freezesEvidenceFrame(demo.stage)}
          corridorRadiusM={evidence?.ai.decision.corridor_radius_m}
          corridorLaneScope={evidence?.ai.decision.corridor_lane_scope}
          priorityByVehicle={priorityByVehicle}
          interactive={presentationActive && demo.phase !== 'preparing'}
          onVehicleSelect={presentationActive ? demo.setInspectedVehicleId : undefined}
        /></Suspense>

        {(demo.phase === 'selecting' || demo.phase === 'preparing') && <SelectionPanel
          vehicles={templateVehicles}
          selectedVehicleId={demo.selectedVehicleId}
          preparing={demo.phase === 'preparing'}
          density={density}
          modelEligible={demo.modelStatus?.eligible ?? false}
          modelReason={demo.modelStatus?.reason ?? null}
          notice={demo.notice}
          onDensityChange={setDensity}
          onStart={() => void demo.start()}
        />}

        {demo.phase === 'preparing' && <div className="preparing-overlay" role="status">
          <span className="loading-orbit" aria-hidden="true" />
          <strong>正在计算同一事故下的真实AI与全量广播结果</strong>
          <small>完成后进入可旋转、缩放和自由跳转的证据舞台</small>
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
          onTogglePause={demo.togglePause}
          onReplay={demo.replay}
          onAutoplay={demo.startAutoplay}
          onSeek={demo.seek}
          onReset={demo.reset}
        />}
      </section> : <Suspense fallback={<div className="scene-loading research-loading" role="status">正在加载研究实验台…</div>}>
        <ResearchWorkspace scenario={demo.scenario} presentationPairs={demo.pairs}
          presentationSource={demo.source} modelEligible={demo.modelStatus?.eligible ?? false}
          modelReason={demo.modelStatus?.reason ?? null} />
      </Suspense>}
    </main>
  )
}
