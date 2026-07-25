import { Box, Camera, Map as MapIcon, MonitorPlay, PenTool, Presentation } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { ComparisonView } from './components/Comparison/ComparisonView'
import { SimulationControl } from './components/ControlPanel/SimulationControl'
import { DemoController } from './components/DemoMode/DemoController'
import { FALLBACK_DEMO_SCENARIOS, type DemoScenario } from './components/DemoMode/DemoScenarios'
import { NarratorOverlay } from './components/DemoMode/NarratorOverlay'
import { DecisionPanel } from './components/DecisionPanel/DecisionPanel'
import { fromMapPosition } from './components/MapView/coordinates'
import { RealtimeMetrics } from './components/MetricsPanel/RealtimeMetrics'
import { DEFAULT_EDITOR_SCENARIO } from './components/SceneEditor/PresetScenes'
import { SceneEditor, type SelectedEntity } from './components/SceneEditor/SceneEditor'
import {
  editorEventToSimulation,
  editorLimitations,
  editorVehicleToSimulation,
  type EditorScenario,
  type EditorScenarioResponse,
  type EditorTool,
} from './components/SceneEditor/sceneTypes'
import { SimulationViewport, type VisualizationMode } from './components/SimulationViewport'
import type { SceneLayout } from './components/ThreeD/Road3D'
import { LoadingSkeleton } from './components/common/LoadingSkeleton'
import { Toast } from './components/common/Toast'
import { useDemoPresentation } from './hooks/useDemoPresentation'
import {
  DEFAULT_MODEL,
  DEFAULT_SCENARIO,
  useSimulationSession,
} from './hooks/useSimulationSession'
import {
  EMPTY_METRICS,
  type ComparisonBaseline,
} from './types/simulation'

type HealthResponse = {
  status: string
  service: string
}

function editorLayout(scenario: EditorScenario): SceneLayout {
  return scenario.vehicles.some((vehicle) => Math.abs(vehicle.y) > 100) ? 'urban' : 'highway'
}

function nextEntityId(prefix: 'vehicle' | 'event', existing: readonly { id: string }[]): string {
  const ids = new Set(existing.map((item) => item.id))
  let index = existing.length
  while (ids.has(`${prefix}_${index}`)) index += 1
  return `${prefix}_${index}`
}

export default function App() {
  const [healthMessage, setHealthMessage] = useState('正在连接后端…')
  const [demoMode, setDemoMode] = useState(false)
  const [demoScenarios, setDemoScenarios] = useState<DemoScenario[]>(FALLBACK_DEMO_SCENARIOS)
  const [demoIndex, setDemoIndex] = useState(0)
  const [demoLoop, setDemoLoop] = useState(true)
  const [visualization, setVisualization] = useState<VisualizationMode>('2d')
  const [sceneLayout, setSceneLayout] = useState<SceneLayout>('highway')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorEditing, setEditorEditing] = useState(false)
  const [editorTool, setEditorTool] = useState<EditorTool>('select')
  const [editorScenario, setEditorScenario] = useState<EditorScenario>(() => structuredClone(DEFAULT_EDITOR_SCENARIO))
  const [editorSelected, setEditorSelected] = useState<SelectedEntity>(null)
  const [editorRunning, setEditorRunning] = useState(false)
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null)
  const session = useSimulationSession()
  const {
    message,
    stateUpdate,
    comparisonPair,
    status,
    errorMessage,
    completed,
    activeState,
    simulationPath,
    requestedSpeed,
    displayMode,
    baseline,
    metricHistory,
    currentSpeed,
    playing,
    start: startSession,
    stop: stopSession,
    control: controlSession,
    changeMode: changeSessionMode,
    changeBaseline: changeSessionBaseline,
  } = session
  const editorVehicles = useMemo(
    () => editorScenario.vehicles.map(editorVehicleToSimulation),
    [editorScenario.vehicles],
  )
  const editorEvents = useMemo(
    () => editorScenario.events.map(editorEventToSimulation),
    [editorScenario.events],
  )

  const runSelectedSimulation = useCallback((scenario?: DemoScenario) => {
    const selected = scenario ?? (demoMode ? demoScenarios[demoIndex] : undefined)
    setSceneLayout(
      selected?.id.includes('urban') || selected?.id.includes('multi') ? 'urban' : 'highway',
    )
    startSession({
      scenario: selected?.scenario,
      model: selected?.model,
      speed: demoMode ? 0.25 : requestedSpeed,
      mode: selected?.mode,
      baseline: selected?.baseline,
    })
  }, [demoIndex, demoMode, demoScenarios, requestedSpeed, startSession])

  const advanceDemoScenario = useCallback((index: number, scenario: DemoScenario) => {
    setDemoIndex(index)
    runSelectedSimulation(scenario)
  }, [runSelectedSimulation])

  const presentation = useDemoPresentation({
    enabled: demoMode,
    scenarios: demoScenarios,
    activeIndex: demoIndex,
    loop: demoLoop,
    activeState,
    comparisonPair,
    completed,
    status,
    simulationPath,
    setVisualization,
    sendControl: controlSession,
    startScenario: runSelectedSimulation,
    advanceScenario: advanceDemoScenario,
  })
  const {
    narrative,
    playing: demoPlaying,
    autoCamera,
    setAutoCamera,
    cameraCommand,
    state: narrativeState,
    events: narrativeEvents,
    effectMode: demoEffectMode,
    comparisonStage,
    overlayComparison,
  } = presentation

  useEffect(() => {
    fetch('/api/v1/health')
      .then((response) => {
        if (!response.ok) throw new Error('后端响应异常')
        return response.json() as Promise<HealthResponse>
      })
      .then((data) => setHealthMessage(`${data.service}：${data.status}`))
      .catch(() => setHealthMessage('前端已就绪，后端尚未连接'))
  }, [])

  useEffect(() => {
    fetch('/api/v1/demo/scenarios')
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('场景目录不可用')))
      .then((data: { scenarios: DemoScenario[] }) => setDemoScenarios(data.scenarios))
      .catch(() => setDemoScenarios(FALLBACK_DEMO_SCENARIOS))
  }, [])

  useEffect(() => {
    if (!simulationPath) return
    if (status === 'connected') setToast({ message: '仿真已连接，开始接收实时状态', tone: 'success' })
    if (errorMessage) setToast({ message: errorMessage, tone: 'error' })
  }, [errorMessage, simulationPath, status])

  const runSimulation = () => runSelectedSimulation()

  const openEditor = () => {
    setDemoMode(false)
    presentation.reset()
    setEditorOpen(true)
    setEditorEditing(true)
    setSceneLayout(editorLayout(editorScenario))
    changeSessionMode('single')
    stopSession()
  }

  const closeEditor = () => {
    setEditorOpen(false)
    setEditorEditing(false)
    setEditorSelected(null)
    setEditorTool('select')
    stopSession()
  }

  const updateEditorScenario = (scenario: EditorScenario) => {
    setEditorScenario(scenario)
    setSceneLayout(editorLayout(scenario))
    if (simulationPath) stopSession()
  }

  const handleEditorMapClick = (latitude: number, longitude: number) => {
    if (!editorOpen || !editorEditing || visualization !== '2d' || editorTool === 'select') return
    const { x, y } = fromMapPosition(latitude, longitude)
    if (editorTool === 'vehicle') {
      if (editorScenario.vehicles.length >= 100) {
        setToast({ message: '车辆数量已达到100辆上限', tone: 'error' })
        return
      }
      const vehicle = {
        id: nextEntityId('vehicle', editorScenario.vehicles),
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        speed_kmh: 60,
        heading: 90,
      }
      updateEditorScenario({ ...editorScenario, vehicles: [...editorScenario.vehicles, vehicle] })
      setEditorSelected({ kind: 'vehicle', id: vehicle.id })
    } else {
      if (editorScenario.events.length >= 5) {
        setToast({ message: '事件数量已达到5个上限', tone: 'error' })
        return
      }
      const event = {
        id: nextEntityId('event', editorScenario.events),
        type: 'emergency_braking' as const,
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        timestamp: 2,
        severity: 0.8,
      }
      updateEditorScenario({ ...editorScenario, events: [...editorScenario.events, event] })
      setEditorSelected({ kind: 'event', id: event.id })
    }
  }

  const runEditorScenario = async () => {
    const limitations = editorLimitations(editorScenario)
    if (limitations.length > 0) {
      setToast({ message: limitations.join('；'), tone: 'error' })
      return
    }
    setEditorRunning(true)
    try {
      const response = await fetch('/api/v1/scenarios/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editorScenario),
      })
      if (!response.ok) throw new Error('后端拒绝了场景配置')
      const result = await response.json() as EditorScenarioResponse
      if (!result.ai_runnable) throw new Error(result.limitations.join('；'))
      startSession({
        scenario: result.scenario_ref,
        model: DEFAULT_MODEL,
        speed: requestedSpeed,
        mode: 'single',
      })
      setSceneLayout(editorLayout(editorScenario))
      setEditorEditing(false)
      setToast({ message: '自定义场景已创建，正在运行真实AI模型', tone: 'success' })
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : '场景创建失败', tone: 'error' })
    } finally {
      setEditorRunning(false)
    }
  }

  const testMessage = message?.type === 'test' ? message.message : null
  const statusText = useMemo(() => {
    if (errorMessage) return errorMessage
    if (completed) return '10个仿真时间步已完成，可重置或重新运行'
    if (activeState) {
      return `仿真时间 ${activeState.timestamp.toFixed(1)}s · ${activeState.vehicles.length} 辆活动车辆`
    }
    if (!simulationPath) return '点击“运行仿真”以加载真实场景和PPO模型'
    return displayMode === 'comparison' ? '正在等待同步对比状态…' : '正在等待第一帧仿真状态…'
  }, [activeState, completed, displayMode, errorMessage, simulationPath])
  const viewportVehicles = editorOpen && !activeState ? editorVehicles : stateUpdate?.vehicles ?? []
  const viewportEvents = editorOpen && !activeState ? editorEvents : stateUpdate?.events ?? []
  const viewportMessages = editorOpen && !activeState ? [] : stateUpdate?.messages ?? []

  return (
    <main className="app-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">G11PROJECT · V2X CONTROL</p>
          <h1>V2X智能通信仿真</h1>
          <p className="subtitle">真实仿真 · 2D/3D视角 · PPO通信决策</p>
        </div>
        <div className="header-actions">
        <div className="visualization-switch" role="group" aria-label="二维或三维视图">
          <button type="button" className={visualization === '2d' ? 'active' : ''}
            aria-pressed={visualization === '2d'} onClick={() => { presentation.userOverrideCamera(); setVisualization('2d') }}>
            <MapIcon aria-hidden="true" />2D
          </button>
          <button type="button" className={visualization === '3d' ? 'active' : ''}
            aria-pressed={visualization === '3d'} onClick={() => { presentation.userOverrideCamera(); setVisualization('3d') }}>
            <Box aria-hidden="true" />3D
          </button>
        </div>
        <button type="button" className={autoCamera ? 'camera-toggle camera-toggle--active' : 'camera-toggle'}
          aria-pressed={autoCamera} onClick={() => setAutoCamera((enabled) => !enabled)}>
          <Camera aria-hidden="true" />自动镜头 {autoCamera ? '开' : '关'}
        </button>
        <button type="button" className={editorOpen ? 'editor-toggle editor-toggle--active' : 'editor-toggle'}
          aria-pressed={editorOpen} onClick={editorOpen ? closeEditor : openEditor}>
          <PenTool aria-hidden="true" />{editorOpen ? '退出编辑' : '场景编辑'}
        </button>
        <button type="button" className={demoMode ? 'presentation-toggle presentation-toggle--active' : 'presentation-toggle'}
          aria-pressed={demoMode} onClick={() => {
            setEditorOpen(false); setEditorEditing(false); presentation.reset()
            setDemoMode((value) => !value); stopSession()
          }}>
          {demoMode ? <MonitorPlay aria-hidden="true" /> : <Presentation aria-hidden="true" />}
          {demoMode ? '退出演示' : '演示模式'}
        </button>
        <div className="connection-panel">
          <span className={`connection-indicator connection-indicator--${status}`} />
          <div>
            <strong>WebSocket：{status}</strong>
            <small>{healthMessage}</small>
            <small data-testid="websocket-message">{testMessage ?? statusText}</small>
          </div>
        </div>
        </div>
      </header>

      {demoMode && <DemoController scenarios={demoScenarios} activeIndex={demoIndex}
        playing={demoPlaying} loop={demoLoop} stage={narrative.stage} elapsedMs={narrative.elapsedMs}
        onSelect={(index) => { setDemoIndex(index); presentation.reset(); stopSession() }}
        onPlayPause={presentation.togglePlayback} onStageMove={narrative.seekStage}
        onLoopChange={setDemoLoop} />}

      {!demoMode && !editorOpen && <section className="view-mode-panel" aria-labelledby="view-mode-heading">
        <div>
          <p className="eyebrow">VIEW MODE</p>
          <h2 id="view-mode-heading">展示模式</h2>
        </div>
        <div className="view-mode-controls">
          <div className="mode-switch" role="group" aria-label="展示模式">
            <button
              type="button"
              className={displayMode === 'single' ? 'mode-button mode-button--active' : 'mode-button'}
              aria-pressed={displayMode === 'single'}
              onClick={() => changeSessionMode('single')}
            >
              单模型
            </button>
            <button
              type="button"
              className={displayMode === 'comparison' ? 'mode-button mode-button--active' : 'mode-button'}
              aria-pressed={displayMode === 'comparison'}
              onClick={() => changeSessionMode('comparison')}
            >
              AI / 基线对比
            </button>
          </div>
          <label className="baseline-select">
            基线策略
            <select
              value={baseline}
              disabled={displayMode !== 'comparison'}
              onChange={(event) => changeSessionBaseline(event.target.value as ComparisonBaseline)}
            >
              <option value="broadcast">全广播</option>
              <option value="distance">距离</option>
              <option value="urgency">紧急度</option>
            </select>
          </label>
        </div>
        <p className="mode-help" aria-live="polite">
          {displayMode === 'comparison'
            ? '切换基线后连接会停止；请点击“运行仿真”启动新的同步对比。'
            : '单模型模式展示 AI 的完整状态、注意力和通信决策。'}
        </p>
      </section>}

      {!demoMode && !editorOpen && <SimulationControl
        status={status}
        playing={playing}
        speed={currentSpeed}
        decision={activeState?.decision ?? null}
        completed={completed}
        onRun={runSimulation}
        onControl={controlSession}
      />}

      {errorMessage && (
        <div className="simulation-alert" role="alert">
          <strong>仿真无法启动：</strong>{errorMessage}。请先按项目说明生成场景并训练PPO模型。
        </div>
      )}

      {demoMode && <NarratorOverlay scenario={demoScenarios[demoIndex]} state={narrativeState}
        comparison={comparisonPair} stage={narrative.stage} event={narrativeEvents[0]} />}

      <RealtimeMetrics metrics={activeState?.metrics ?? EMPTY_METRICS} history={metricHistory} />
      <div className="simulation-workspace">
        {simulationPath && !activeState && !errorMessage ? <LoadingSkeleton /> : displayMode === 'comparison' && (!demoMode || comparisonStage) ? (
          <ComparisonView pair={comparisonPair} baseline={baseline} visualization={visualization}
            layout={sceneLayout} overlay={overlayComparison} effectMode={demoMode ? demoEffectMode : 'all'}
            cameraCommand={cameraCommand} onManualCamera={presentation.userOverrideCamera}
            onTileError={(message) => setToast({ message, tone: 'error' })} />
        ) : (
          <SimulationViewport
            visualization={visualization}
            layout={sceneLayout}
            vehicles={demoMode ? activeState?.vehicles ?? [] : viewportVehicles}
            events={demoMode ? narrativeEvents : viewportEvents}
            messages={demoMode ? narrativeState?.messages ?? [] : viewportMessages}
            attentionWeights={(demoMode ? activeState : stateUpdate)?.attention_weights ?? []}
            candidateIds={(demoMode ? narrativeState : stateUpdate)?.decision.candidate_vehicles?.map((vehicle) => vehicle.id) ?? []}
            animationChannel={demoMode && displayMode === 'comparison' ? 'comparison-ai' : 'single'}
            effectMode={demoMode ? demoEffectMode : 'all'}
            cameraCommand={cameraCommand}
            onManualCamera={presentation.userOverrideCamera}
            editing={editorOpen && editorEditing}
            onMapClick={handleEditorMapClick}
            onVehicleSelect={(vehicle) => editorOpen && setEditorSelected({ kind: 'vehicle', id: vehicle.id })}
            onEventSelect={(event) => editorOpen && setEditorSelected({ kind: 'event', id: event.id })}
            onTileError={(message) => setToast({ message, tone: 'error' })}
          />
        )}
        {editorOpen ? <SceneEditor
          scenario={editorScenario}
          editing={editorEditing}
          tool={editorTool}
          selected={editorSelected}
          visualization={visualization}
          running={editorRunning}
          onScenarioChange={updateEditorScenario}
          onEditingChange={setEditorEditing}
          onToolChange={setEditorTool}
          onSelectedChange={setEditorSelected}
          onRun={() => void runEditorScenario()}
          onClose={closeEditor}
          onNotice={(message, tone) => setToast({ message, tone })}
        /> : !demoMode && <DecisionPanel decision={activeState?.decision ?? null} />}
      </div>
      <footer className="demo-notice">
        {editorOpen
          ? '编辑器预览使用仿真投影坐标；仅满足当前模型容量的场景可以运行真实AI。'
          : `数据来自后端V2X环境与PPO模型；场景：${DEFAULT_SCENARIO} · 模型：${DEFAULT_MODEL}`}
      </footer>
      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />}
    </main>
  )
}
