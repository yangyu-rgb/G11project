import { useEffect, useState } from 'react'

type HealthResponse = {
  status: string
  service: string
}

export default function App() {
  const [message, setMessage] = useState('正在连接后端…')

  useEffect(() => {
    fetch('/api/v1/health')
      .then((response) => {
        if (!response.ok) throw new Error('后端响应异常')
        return response.json() as Promise<HealthResponse>
      })
      .then((data) => setMessage(`${data.service}：${data.status}`))
      .catch(() => setMessage('前端已就绪，后端尚未连接'))
  }, [])

  return (
    <main className="app-shell">
      <section className="card">
        <p className="eyebrow">G11PROJECT</p>
        <h1>前后端基础架构已就绪</h1>
        <p className="status">{message}</p>
      </section>
    </main>
  )
}
