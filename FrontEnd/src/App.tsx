import { useEffect, useState } from 'react'

import { MapView } from './components/MapView/MapView'
import { RealtimeMetrics } from './components/MetricsPanel/RealtimeMetrics'
import { mockEvents, mockMessages, mockMetrics, mockVehicles } from './data/mockSimulation'
import { useWebSocket } from './hooks/useWebSocket'

type HealthResponse = {
  status: string
  service: string
}

export default function App() {
  const [healthMessage, setHealthMessage] = useState('正在连接后端…')
  const { message, status } = useWebSocket()

  useEffect(() => {
    fetch('/api/v1/health')
      .then((response) => {
        if (!response.ok) throw new Error('后端响应异常')
        return response.json() as Promise<HealthResponse>
      })
      .then((data) => setHealthMessage(`${data.service}：${data.status}`))
      .catch(() => setHealthMessage('前端已就绪，后端尚未连接'))
  }, [])

  return (
    <main className="app-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">G11PROJECT · V2X CONTROL</p>
          <h1>高速公路通信仿真</h1>
          <p className="subtitle">M1本地演示场景 · 5辆车 · 1个急刹事件</p>
        </div>
        <div className="connection-panel">
          <span className={`connection-indicator connection-indicator--${status}`} />
          <div>
            <strong>WebSocket：{status}</strong>
            <small>{healthMessage}</small>
            <small data-testid="websocket-message">{message?.message ?? '等待后端test消息…'}</small>
          </div>
        </div>
      </header>
      <RealtimeMetrics metrics={mockMetrics} />
      <MapView vehicles={mockVehicles} events={mockEvents} messages={mockMessages} />
      <footer className="demo-notice">
        本轮地图、传播动画与指标使用前端本地mock数据；真实仿真数据集成将在后续任务完成。
      </footer>
    </main>
  )
}
