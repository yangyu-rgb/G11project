import { Activity, RadioTower } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'

import { DemoHud, SelectionPanel } from './components/Presentation/PresentationOverlay'
import { HIGHWAY_PRESENTATION_SCENARIO } from './components/SceneEditor/PresetScenes'
import { editorVehicleToSimulation } from './components/SceneEditor/sceneTypes'
import { usePresentationDemo } from './hooks/usePresentationDemo'

const Scene3D = lazy(() => import('./components/ThreeD/Scene3D').then((module) => ({
  default: module.Scene3D,
})))

type HealthResponse = { status: string; service: string }

export default function App() {
  const [health, setHealth] = useState('正在连接后端')
  const demo = usePresentationDemo(HIGHWAY_PRESENTATION_SCENARIO)
  const templateVehicles = useMemo(
    () => HIGHWAY_PRESENTATION_SCENARIO.vehicles.map(editorVehicleToSimulation),
    [],
  )

  useEffect(() => {
    fetch('/api/v1/health')
      .then((response) => response.ok ? response.json() as Promise<HealthResponse> : Promise.reject())
      .then((data) => setHealth(`${data.service} · ${data.status}`))
      .catch(() => setHealth('后端尚未连接'))
  }, [])

  const evidence = demo.evidence
  const presentationActive = demo.phase === 'playing' || demo.phase === 'paused' || demo.phase === 'complete'
  const stageState = demo.stage === 'broadcast' ? evidence?.baseline : evidence?.ai
  const vehicles = presentationActive ? evidence?.ai.vehicles ?? templateVehicles : templateVehicles
  const events = presentationActive && demo.stage !== 'normal' ? evidence?.ai.events ?? [] : []
  const messages = demo.stage === 'broadcast' ? evidence?.baseline.messages ?? []
    : demo.stage === 'ai' ? evidence?.ai.messages ?? [] : []
  const candidateIds = presentationActive && demo.stage === 'ai'
    ? evidence?.ai.decision.candidate_vehicles?.map((vehicle) => vehicle.id) ?? [] : []
  const notifiedIds = presentationActive && (demo.stage === 'broadcast' || demo.stage === 'ai')
    ? stageState?.decision.selected_receivers ?? [] : []
  const channel = demo.stage === 'broadcast' ? 'comparison-baseline' as const : 'comparison-ai' as const
  const connectionLabel = demo.phase === 'complete' ? '结果已就绪'
    : demo.phase === 'selecting' ? '待机' : demo.connectionStatus

  return (
    <main className="presentation-app">
      <header className="presentation-header">
        <div className="brand-lockup">
          <RadioTower aria-hidden="true" />
          <div>
            <p>6G自主驾驶网络</p>
            <h1>AI赋能的选择性V2X通信</h1>
          </div>
        </div>
        <div className="system-status" aria-live="polite">
          <Activity aria-hidden="true" />
          <span>{health}</span>
          <b>{connectionLabel}</b>
        </div>
      </header>

      <section className="scene-shell" aria-label="V2X三维演示工作区">
        <Suspense fallback={<div className="scene-loading" role="status">正在加载3D场景…</div>}><Scene3D
          vehicles={vehicles}
          events={events}
          messages={messages}
          animationChannel={channel}
          messageTone={demo.stage === 'broadcast' ? 'baseline' : 'ai'}
          candidateIds={candidateIds}
          notifiedIds={notifiedIds}
          selectedVehicleId={demo.selectedVehicleId}
          accidentVehicleId={presentationActive ? demo.selectedVehicleId : null}
          stage={demo.stage}
          interactive={demo.phase === 'selecting'}
          onVehicleSelect={demo.setSelectedVehicleId}
        /></Suspense>

        {(demo.phase === 'selecting' || demo.phase === 'preparing') && <SelectionPanel
          vehicles={templateVehicles}
          selectedVehicleId={demo.selectedVehicleId}
          preparing={demo.phase === 'preparing'}
          onSelect={demo.setSelectedVehicleId}
          onStart={() => void demo.start()}
        />}

        {demo.phase === 'preparing' && <div className="preparing-overlay" role="status">
          <span className="loading-orbit" aria-hidden="true" />
          <strong>正在计算同一事故下的真实AI与全量广播结果</strong>
          <small>完成后将自动播放38秒演示</small>
        </div>}

        {presentationActive && demo.selectedVehicleId && <DemoHud
          phase={demo.phase}
          source={demo.source}
          stage={demo.stage}
          elapsedMs={demo.elapsedMs}
          evidence={evidence}
          accidentVehicleId={demo.selectedVehicleId}
          notice={demo.notice}
          onTogglePause={demo.togglePause}
          onReplay={demo.replay}
          onReset={demo.reset}
        />}
      </section>
    </main>
  )
}
