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
  DEFAULT_PRESENTATION_ATMOSPHERE,
  DEFAULT_PRESENTATION_ENVIRONMENT,
  DEFAULT_RENDER_PREFERENCE,
  DEFAULT_SCENE_LAYERS,
  type PresentationAtmosphere,
  type PresentationEnvironment,
  type RenderPreference,
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
  const [health, setHealth] = useState('Connecting to backend')
  const [workspace, setWorkspace] = useState<'presentation' | 'research'>('presentation')
  const [validationTask, setValidationTask] = useState<ValidationTask>('decision')
  const [density, setDensity] = useState<PresentationDensity>('dense')
  const [environmentPreset, setEnvironmentPreset] = useState<PresentationEnvironment>(
    DEFAULT_PRESENTATION_ENVIRONMENT,
  )
  const [atmosphere, setAtmosphere] = useState<PresentationAtmosphere>(
    DEFAULT_PRESENTATION_ATMOSPHERE,
  )
  const [renderPreference, setRenderPreference] = useState<RenderPreference>(
    DEFAULT_RENDER_PREFERENCE,
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
      .catch(() => setHealth('Backend unavailable'))
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
  const connectionLabel = demo.phase === 'complete' ? 'Results ready'
    : demo.phase === 'selecting' ? 'Standby' : demo.connectionStatus
  const comparisonVisible = presentationActive && Boolean(evidence)
    && (demo.stage === 'comparison' || demo.stage === 'summary')
  const comparisonPair = evidence
  const openValidation = (task: ValidationTask = 'decision') => {
    if (demo.phase === 'playing') demo.togglePause()
    setValidationTask(task)
    setWorkspace('research')
  }

  return (
    <main className={`presentation-app presentation-app--${workspace} presentation-app--${environmentPreset} presentation-app--${atmosphere}`}>
      <header className="presentation-header">
        <div className="brand-lockup">
          <RadioTower aria-hidden="true" />
          <div>
            <p>6G Autonomous Mobility Network</p>
            <h1>AI-Assisted Selective V2X Communication</h1>
          </div>
        </div>
        <nav className="workspace-switch" aria-label="Workspace">
          <button type="button" className={workspace === 'presentation' ? 'is-active' : ''}
            onClick={() => setWorkspace('presentation')}>
            <Presentation aria-hidden="true" />Presentation Demo
          </button>
          <button type="button" className={workspace === 'research' ? 'is-active' : ''}
            onClick={() => openValidation('decision')}>
            <FlaskConical aria-hidden="true" />Validation Lab
          </button>
        </nav>
        <div className="system-status" aria-live="polite">
          <Activity aria-hidden="true" />
          <span>{health}</span>
          <b>{connectionLabel}</b>
        </div>
      </header>

      {workspace === 'presentation' ? <section className="scene-shell" aria-label="3D V2X presentation workspace">
        {selectingVehicle || demo.phase === 'preparing' ? <div
          className={`setup-stage-backdrop setup-stage-backdrop--${environmentPreset} setup-stage-backdrop--${atmosphere}`}
          aria-hidden="true"><i /><i /><i /></div>
          : <Suspense fallback={<div className="scene-loading" role="status">Loading 3D scene…</div>}>{comparisonVisible && comparisonPair && demo.selectedVehicleId
          ? <ComparisonScene3D pair={comparisonPair} accidentVehicleId={demo.selectedVehicleId}
            selectedVehicleId={demo.inspectedVehicleId} priorityByVehicle={priorityByVehicle}
            elapsedMs={demo.elapsedMs} stage={demo.stage}
            baseline={demo.selectedBaseline} environmentPreset={environmentPreset}
            atmosphere={atmosphere} renderPreference={renderPreference}
            layers={DEFAULT_SCENE_LAYERS}
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
          bandwidthFraction={currentAI?.decision.bandwidth_fraction}
          environmentPreset={environmentPreset}
          atmosphere={atmosphere}
          renderPreference={renderPreference}
          layers={DEFAULT_SCENE_LAYERS}
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
          atmosphere={atmosphere}
          renderPreference={renderPreference}
          modelEligible={demo.modelStatus?.eligible ?? false}
          modelReason={demo.modelStatus?.reason ?? null}
          modelHash={demoResults.results?.provenance?.model_sha256 ?? null}
          notice={demo.notice}
          baseline={demo.selectedBaseline}
          onDensityChange={setDensity}
          onEnvironmentChange={setEnvironmentPreset}
          onAtmosphereChange={setAtmosphere}
          onRenderPreferenceChange={setRenderPreference}
          onVehicleSelect={demo.setSelectedVehicleId}
          onBaselineChange={demo.setSelectedBaseline}
          onStart={() => void demo.start()}
        />}

        {demo.phase === 'preparing' && <div className="preparing-overlay" role="status">
          <span className="loading-orbit" aria-hidden="true" />
          <strong>Computing synchronized production AI and {demo.selectedBaseline === 'broadcast' ? 'Broadcast'
            : demo.selectedBaseline === 'distance' ? 'Fixed Radius' : 'Urgency Scheduling'} results</strong>
          <small>Same scenario, random seed, and simulation timestamp</small>
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
          atmosphere={atmosphere}
          onTogglePause={demo.togglePause}
          onReplay={demo.replay}
          onAutoplay={demo.startAutoplay}
          onSeek={demo.seek}
          onReset={demo.reset}
          onOpenValidation={() => openValidation('decision')}
        />}
      </section> : <Suspense fallback={<div className="scene-loading research-loading" role="status">Loading Validation Lab…</div>}>
        <ResearchWorkspace scenario={demo.scenario} presentationPairs={demo.pairs}
          presentationSource={demo.source} modelEligible={demo.modelStatus?.eligible ?? false}
          modelReason={demo.modelStatus?.reason ?? null} initialTask={validationTask}
          environmentPreset={environmentPreset} atmosphere={atmosphere}
          renderPreference={renderPreference} />
      </Suspense>}
    </main>
  )
}
