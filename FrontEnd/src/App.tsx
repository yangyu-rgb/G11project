import { useEffect, useMemo, useState } from 'react'

import { ComparisonView } from './components/ComparisonView/ComparisonView'
import { SimulationControl } from './components/ControlPanel/SimulationControl'
import { DecisionPanel } from './components/DecisionPanel/DecisionPanel'
import { MapView } from './components/MapView/MapView'
import { RealtimeMetrics } from './components/MetricsPanel/RealtimeMetrics'
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
    if (!activeState) return
    setMetricHistory((history) => {
      const point = { timestamp: activeState.timestamp, ...activeState.metrics }
      const withoutDuplicate = history.filter((item) => item.timestamp !== point.timestamp)
      return [...withoutDuplicate, point].slice(-30)
    })
  }, [activeState])

  const stopAndClear = () => {
    setSimulationPath(null)
    setMetricHistory([])
    clearState()
  }

  const runSimulation = () => {
    const nextRunId = runId + 1
    const query = new URLSearchParams({
      scenario: DEFAULT_SCENARIO,
      model: DEFAULT_MODEL,
      speed: String(requestedSpeed),
      run_id: String(nextRunId),
    })
    clearState()
    setMetricHistory([])
    setRunId(nextRunId)
    setSimulationPath(
      displayMode === 'comparison'
        ? `/ws/simulation/compare?${query.toString()}&baseline=${baseline}`
        : `/ws/simulation/run?${query.toString()}`,
    )
  }

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
        <div className="connection-panel">
          <span className={`connection-indicator connection-indicator--${status}`} />
          <div>
            <strong>WebSocket：{status}</strong>
            <small>{healthMessage}</small>
            <small data-testid="websocket-message">{testMessage ?? statusText}</small>
          </div>
        </div>
      </header>

      <section className="view-mode-panel" aria-labelledby="view-mode-heading">
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
      </section>

      <SimulationControl
        status={status}
        playing={playing}
        speed={currentSpeed}
        decision={activeState?.decision ?? null}
        completed={completed}
        onRun={runSimulation}
        onControl={controlSimulation}
      />

      {errorMessage && (
        <div className="simulation-alert" role="alert">
          <strong>仿真无法启动：</strong>{errorMessage}。请先按项目说明生成场景并训练PPO模型。
        </div>
      )}

      <RealtimeMetrics metrics={activeState?.metrics ?? EMPTY_METRICS} history={metricHistory} />
      <div className="simulation-workspace">
        {displayMode === 'comparison' ? (
          <ComparisonView pair={comparisonPair} baseline={baseline} />
        ) : (
          <MapView
            vehicles={stateUpdate?.vehicles ?? []}
            events={stateUpdate?.events ?? []}
            messages={stateUpdate?.messages ?? []}
            attentionWeights={stateUpdate?.attention_weights ?? []}
          />
        )}
        <DecisionPanel decision={activeState?.decision ?? null} />
      </div>
      <footer className="demo-notice">
        数据来自后端V2X环境与PPO模型；场景：{DEFAULT_SCENARIO} · 模型：{DEFAULT_MODEL}
      </footer>
    </main>
  )
}
