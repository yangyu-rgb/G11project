import { useEffect, useMemo, useState } from 'react'

import { SimulationControl } from './components/ControlPanel/SimulationControl'
import { MapView } from './components/MapView/MapView'
import { RealtimeMetrics } from './components/MetricsPanel/RealtimeMetrics'
import { useWebSocket } from './hooks/useWebSocket'
import { EMPTY_METRICS, type ControlAction } from './types/simulation'

type HealthResponse = {
  status: string
  service: string
}

const DEFAULT_SCENARIO = 'experiments/test_scenario'
const DEFAULT_MODEL = 'experiments/test_ppo/model.zip'

export default function App() {
  const [healthMessage, setHealthMessage] = useState('正在连接后端…')
  const [runId, setRunId] = useState(0)
  const [simulationPath, setSimulationPath] = useState<string | null>(null)
  const [requestedSpeed, setRequestedSpeed] = useState(1)
  const {
    message,
    stateUpdate,
    controlState,
    status,
    errorMessage,
    completed,
    sendControl,
    clearState,
  } = useWebSocket(simulationPath, false)

  useEffect(() => {
    fetch('/api/v1/health')
      .then((response) => {
        if (!response.ok) throw new Error('后端响应异常')
        return response.json() as Promise<HealthResponse>
      })
      .then((data) => setHealthMessage(`${data.service}：${data.status}`))
      .catch(() => setHealthMessage('前端已就绪，后端尚未连接'))
  }, [])

  const runSimulation = () => {
    const nextRunId = runId + 1
    const query = new URLSearchParams({
      scenario: DEFAULT_SCENARIO,
      model: DEFAULT_MODEL,
      speed: String(requestedSpeed),
      run_id: String(nextRunId),
    })
    clearState()
    setRunId(nextRunId)
    setSimulationPath(`/ws/simulation/run?${query.toString()}`)
  }

  const controlSimulation = (action: ControlAction, speed?: number) => {
    if (action === 'set_speed' && speed !== undefined) setRequestedSpeed(speed)
    sendControl(action, speed)
  }

  const testMessage = message?.type === 'test' ? message.message : null
  const currentSpeed = controlState?.speed ?? requestedSpeed
  const playing = controlState?.playing ?? (status === 'connected' && !completed)
  const statusText = useMemo(() => {
    if (errorMessage) return errorMessage
    if (completed) return '10个仿真时间步已完成，可重置或重新运行'
    if (stateUpdate) return `仿真时间 ${stateUpdate.timestamp.toFixed(1)}s · ${stateUpdate.vehicles.length}/50 辆活动车辆`
    if (!simulationPath) return '点击“运行仿真”以加载真实场景和PPO模型'
    return '正在等待第一帧仿真状态…'
  }, [completed, errorMessage, simulationPath, stateUpdate])

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

      <SimulationControl
        status={status}
        playing={playing}
        speed={currentSpeed}
        decision={stateUpdate?.decision ?? null}
        completed={completed}
        onRun={runSimulation}
        onControl={controlSimulation}
      />

      {errorMessage && (
        <div className="simulation-alert" role="alert">
          <strong>仿真无法启动：</strong>{errorMessage}。请先按项目说明生成场景并训练PPO模型。
        </div>
      )}

      <RealtimeMetrics metrics={stateUpdate?.metrics ?? EMPTY_METRICS} />
      <MapView
        vehicles={stateUpdate?.vehicles ?? []}
        events={stateUpdate?.events ?? []}
        messages={stateUpdate?.messages ?? []}
      />
      <footer className="demo-notice">
        数据来自后端V2X环境与PPO模型；场景：{DEFAULT_SCENARIO} · 模型：{DEFAULT_MODEL}
      </footer>
    </main>
  )
}
