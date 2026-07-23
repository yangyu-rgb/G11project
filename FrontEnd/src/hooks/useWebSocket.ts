import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  ControlAction,
  ControlAckMessage,
  SimulationMessage,
  StateUpdateMessage,
} from '../types/simulation'

export type { SimulationMessage } from '../types/simulation'

export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

const RECONNECT_DELAY_MS = 2000

function websocketUrl(path: string) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${path}`
}

function isSimulationMessage(value: unknown): value is SimulationMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false
  return ['test', 'state_update', 'control_ack', 'error', 'simulation_complete'].includes(
    String(value.type),
  )
}

export function useWebSocket(path: string | null = '/ws/simulation', autoReconnect = true) {
  const socketRef = useRef<WebSocket | null>(null)
  const [message, setMessage] = useState<SimulationMessage | null>(null)
  const [stateUpdate, setStateUpdate] = useState<StateUpdateMessage | null>(null)
  const [controlState, setControlState] = useState<ControlAckMessage | null>(null)
  const [status, setStatus] = useState<WebSocketStatus>(path ? 'connecting' : 'disconnected')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)

  useEffect(() => {
    if (!path) return

    let active = true
    let reconnectTimer: number | null = null

    const connect = () => {
      if (!active) return
      setStatus('connecting')
      const socket = new WebSocket(websocketUrl(path))
      socketRef.current = socket

      socket.onopen = () => {
        setStatus('connected')
        setErrorMessage(null)
      }
      socket.onmessage = (event) => {
        try {
          const parsed: unknown = JSON.parse(event.data)
          if (!isSimulationMessage(parsed)) throw new Error('不支持的WebSocket消息格式')
          setMessage(parsed)
          if (parsed.type === 'state_update') setStateUpdate(parsed)
          if (parsed.type === 'control_ack') setControlState(parsed)
          if (parsed.type === 'error') {
            setErrorMessage(parsed.message)
            setStatus('error')
          }
          if (parsed.type === 'simulation_complete') setCompleted(true)
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : 'WebSocket消息解析失败')
          setStatus('error')
        }
      }
      socket.onerror = () => {
        setErrorMessage('无法连接仿真服务，请确认后端、场景和模型均已准备好')
        setStatus('error')
      }
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null
        if (!active) return
        setStatus('disconnected')
        if (autoReconnect) reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS)
      }
    }

    connect()
    return () => {
      active = false
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [autoReconnect, path])

  const sendControl = useCallback((action: ControlAction, speed?: number) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setErrorMessage('仿真服务尚未连接')
      return false
    }
    socket.send(JSON.stringify({ type: 'control', action, ...(speed === undefined ? {} : { speed }) }))
    if (action === 'reset') {
      setStateUpdate(null)
      setCompleted(false)
    }
    return true
  }, [])

  const clearState = useCallback(() => {
    setStateUpdate(null)
    setControlState(null)
    setErrorMessage(null)
    setCompleted(false)
  }, [])

  return { message, stateUpdate, controlState, status, errorMessage, completed, sendControl, clearState }
}
