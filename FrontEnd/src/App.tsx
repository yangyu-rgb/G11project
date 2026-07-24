import { MonitorPlay, Presentation } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { ComparisonView } from './components/ComparisonView/ComparisonView'
import { SimulationControl } from './components/ControlPanel/SimulationControl'
import { DemoController } from './components/DemoMode/DemoController'
import { FALLBACK_DEMO_SCENARIOS, type DemoScenario } from './components/DemoMode/DemoScenarios'
import { NarratorOverlay } from './components/DemoMode/NarratorOverlay'
import { DecisionPanel } from './components/DecisionPanel/DecisionPanel'
import { MapView } from './components/MapView/MapView'
import { RealtimeMetrics } from './components/MetricsPanel/RealtimeMetrics'
import { LoadingSkeleton } from './components/common/LoadingSkeleton'
import { Toast } from './components/common/Toast'
import { useWebSocket } from './hooks/useWebSocket'
import {
  EMPTY_METRICS,
  type ComparisonBaseline,
  type ControlAction,
  type MetricHistoryPoint,
} from './types/simulation'

type HealthResponse = {
  status: string
  service: string
}

type DisplayMode = 'single' | 'comparison'

const DEFAULT_SCENARIO = 'experiments/test_scenario'
const DEFAULT_MODEL = 'experiments/test_ppo/model.zip'

export default function App() {
  const [healthMessage, setHealthMessage] = useState('正在连接后端…')
  const [runId, setRunId] = useState(0)
  const [simulationPath, setSimulationPath] = useState<string | null>(null)
  const [requestedSpeed, setRequestedSpeed] = useState(1)
  const [displayMode, setDisplayMode] = useState<DisplayMode>('single')
  const [baseline, setBaseline] = useState<ComparisonBaseline>('distance')
  const [metricHistory, setMetricHistory] = useState<MetricHistoryPoint[]>([])
  const [demoMode, setDemoMode] = useState(false)
  const [demoScenarios, setDemoScenarios] = useState<DemoScenario[]>(FALLBACK_DEMO_SCENARIOS)
  const [demoIndex, setDemoIndex] = useState(0)
  const [demoLoop, setDemoLoop] = useState(true)
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null)
  const {
    message,
    stateUpdate,
    comparisonPair,
    controlState,
    status,
    errorMessage,
    completed,
    sendControl,
    clearState,
  } = useWebSocket(simulationPath, false)
  const activeState = displayMode === 'comparison' ? comparisonPair?.ai ?? null : stateUpdate

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
    if (!activeState) return
    setMetricHistory((history) => {
      const point = { timestamp: activeState.timestamp, ...activeState.metrics }
      const withoutDuplicate = history.filter((item) => item.timestamp !== point.timestamp)
      return [...withoutDuplicate, point].slice(-30)
    })
  }, [activeState])

  useEffect(() => {
    if (!simulationPath) return
    if (status === 'connected') setToast({ message: '仿真已连接，开始接收实时状态', tone: 'success' })
    if (errorMessage) setToast({ message: errorMessage, tone: 'error' })
  }, [errorMessage, simulationPath, status])

  const stopAndClear = () => {
    setSimulationPath(null)
    setMetricHistory([])
    clearState()
  }

  const runSelectedSimulation = useCallback((scenario?: DemoScenario) => {
    const nextRunId = runId + 1
    const selectedScenario = scenario ?? (demoMode ? demoScenarios[demoIndex] : undefined)
    const query = new URLSearchParams({
      scenario: selectedScenario?.scenario ?? DEFAULT_SCENARIO,
      model: selectedScenario?.model ?? DEFAULT_MODEL,
      speed: String(requestedSpeed),
      run_id: String(nextRunId),
    })
    clearState()
    setMetricHistory([])
    setRunId(nextRunId)
    const nextMode = selectedScenario?.mode ?? displayMode
    const nextBaseline = selectedScenario?.baseline ?? baseline
    if (selectedScenario) {
      setDisplayMode(nextMode)
      setBaseline(nextBaseline)
    }
    setSimulationPath(
      nextMode === 'comparison'
        ? `/ws/simulation/compare?${query.toString()}&baseline=${nextBaseline}`
        : `/ws/simulation/run?${query.toString()}`,
    )
  }, [baseline, demoIndex, demoMode, demoScenarios, displayMode, requestedSpeed, runId, clearState])

  const runSimulation = () => runSelectedSimulation()

  useEffect(() => {
    if (!demoMode || !completed || !demoLoop) return
    const available = demoScenarios
      .map((scenario, index) => ({ scenario, index }))
      .filter((item) => item.scenario.available)
    const currentPosition = available.findIndex((item) => item.index === demoIndex)
    const next = available[(currentPosition + 1) % available.length]
    if (!next || next.index === demoIndex && available.length === 1) return
    const timer = window.setTimeout(() => {
      setDemoIndex(next.index)
      runSelectedSimulation(next.scenario)
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [completed, demoIndex, demoLoop, demoMode, demoScenarios, runSelectedSimulation])

  const changeMode = (mode: DisplayMode) => {
    if (mode === displayMode) return
    setDisplayMode(mode)
    stopAndClear()
  }

  const changeBaseline = (nextBaseline: ComparisonBaseline) => {
    if (nextBaseline === baseline) return
    setBaseline(nextBaseline)
    stopAndClear()
  }

  const controlSimulation = (action: ControlAction, speed?: number) => {
    if (action === 'set_speed' && speed !== undefined) setRequestedSpeed(speed)
    if (action === 'reset') setMetricHistory([])
    sendControl(action, speed)
  }

  const testMessage = message?.type === 'test' ? message.message : null
  const currentSpeed = controlState?.speed ?? requestedSpeed
  const playing = controlState?.playing ?? (status === 'connected' && !completed)
  const statusText = useMemo(() => {
    if (errorMessage) return errorMessage
    if (completed) return '10个仿真时间步已完成，可重置或重新运行'
    if (activeState) {
      return `仿真时间 ${activeState.timestamp.toFixed(1)}s · ${activeState.vehicles.length} 辆活动车辆`
    }
    if (!simulationPath) return '点击“运行仿真”以加载真实场景和PPO模型'
    return displayMode === 'comparison' ? '正在等待同步对比状态…' : '正在等待第一帧仿真状态…'
  }, [activeState, completed, displayMode, errorMessage, simulationPath])

  return (
    <main className="app-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">G11PROJECT · V2X CONTROL</p>
          <h1>高速公路通信仿真</h1>
          <p className="subtitle">M1真实场景 · 最多50辆活动车辆 · PPO通信决策</p>
        </div>
        <div className="header-actions">
        <button type="button" className={demoMode ? 'presentation-toggle presentation-toggle--active' : 'presentation-toggle'}
          aria-pressed={demoMode} onClick={() => { setDemoMode((value) => !value); stopAndClear() }}>
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
        playing={playing} loop={demoLoop} speed={currentSpeed}
        onSelect={(index) => { setDemoIndex(index); stopAndClear() }}
        onPlayPause={() => status === 'connected' ? controlSimulation(playing ? 'pause' : 'play') : runSelectedSimulation()}
        onLoopChange={setDemoLoop} onSpeedChange={(speed) => controlSimulation('set_speed', speed)} />}

      {!demoMode && <section className="view-mode-panel" aria-labelledby="view-mode-heading">
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
              onClick={() => changeMode('single')}
            >
              单模型
            </button>
            <button
              type="button"
              className={displayMode === 'comparison' ? 'mode-button mode-button--active' : 'mode-button'}
              aria-pressed={displayMode === 'comparison'}
              onClick={() => changeMode('comparison')}
            >
              AI / 基线对比
            </button>
          </div>
          <label className="baseline-select">
            基线策略
            <select
              value={baseline}
              disabled={displayMode !== 'comparison'}
              onChange={(event) => changeBaseline(event.target.value as ComparisonBaseline)}
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

      {!demoMode && <SimulationControl
        status={status}
        playing={playing}
        speed={currentSpeed}
        decision={activeState?.decision ?? null}
        completed={completed}
        onRun={runSimulation}
        onControl={controlSimulation}
      />}

      {errorMessage && (
        <div className="simulation-alert" role="alert">
          <strong>仿真无法启动：</strong>{errorMessage}。请先按项目说明生成场景并训练PPO模型。
        </div>
      )}

      {demoMode && <NarratorOverlay scenario={demoScenarios[demoIndex]} state={activeState} comparison={comparisonPair} />}

      <RealtimeMetrics metrics={activeState?.metrics ?? EMPTY_METRICS} history={metricHistory} />
      <div className="simulation-workspace">
        {simulationPath && !activeState && !errorMessage ? <LoadingSkeleton /> : displayMode === 'comparison' ? (
          <ComparisonView pair={comparisonPair} baseline={baseline} />
        ) : (
          <MapView
            vehicles={stateUpdate?.vehicles ?? []}
            events={stateUpdate?.events ?? []}
            messages={stateUpdate?.messages ?? []}
            attentionWeights={stateUpdate?.attention_weights ?? []}
          />
        )}
        {!demoMode && <DecisionPanel decision={activeState?.decision ?? null} />}
      </div>
      <footer className="demo-notice">
        数据来自后端V2X环境与PPO模型；场景：{DEFAULT_SCENARIO} · 模型：{DEFAULT_MODEL}
      </footer>
      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />}
    </main>
  )
}
