import { useEffect, useState } from 'react'

export type SimulationMessage = {
  type: 'test'
  timestamp: number
  message: string
}

export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

const RECONNECT_DELAY_MS = 2000

function websocketUrl(path: string) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${path}`
}

export function useWebSocket(path = '/ws/simulation') {
  const [message, setMessage] = useState<SimulationMessage | null>(null)
  const [status, setStatus] = useState<WebSocketStatus>('connecting')

  useEffect(() => {
    let active = true
    let socket: WebSocket | null = null
    let reconnectTimer: number | null = null

    const connect = () => {
      if (!active) return

      setStatus('connecting')
      socket = new WebSocket(websocketUrl(path))

      socket.onopen = () => setStatus('connected')
      socket.onmessage = (event) => {
        try {
          const nextMessage = JSON.parse(event.data) as SimulationMessage
          setMessage(nextMessage)
          console.info('WebSocket message received', nextMessage)
        } catch {
          setStatus('error')
        }
      }
      socket.onerror = () => setStatus('error')
      socket.onclose = () => {
        if (!active) return
        setStatus('disconnected')
        reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS)
      }
    }

    connect()

    return () => {
      active = false
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [path])

  return { message, status }
}
