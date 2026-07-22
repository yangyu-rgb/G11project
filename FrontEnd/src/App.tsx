import { useEffect, useState } from 'react'

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
      <section className="card">
        <p className="eyebrow">G11PROJECT</p>
        <h1>前后端基础架构已就绪</h1>
        <p className="status">健康检查：{healthMessage}</p>
        <p className="status">WebSocket：{status}</p>
        <p className="status" data-testid="websocket-message">
          最新消息：{message?.message ?? '等待后端推送…'}
        </p>
        {message && (
          <p className="status">时间戳：{message.timestamp.toFixed(3)}</p>
        )}
      </section>
    </main>
  )
}
