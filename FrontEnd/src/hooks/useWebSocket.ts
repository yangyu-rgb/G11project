import { useCallback, useEffect, useRef, useState } from 'react'

import { useAnimationRuntime } from '../runtime/AnimationRuntimeContext'

import type {
  ComparisonPair,
  ControlAction,
  ControlAckMessage,
  SimulationMessage,
  StateUpdateMessage,
} from '../types/simulation'

export type { SimulationMessage } from '../types/simulation'

export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

const RECONNECT_DELAY_MS = 2000

export type ComparisonUpdateCache = {
  ai: Map<number, StateUpdateMessage>
  baseline: Map<number, StateUpdateMessage>
}

export function createComparisonUpdateCache(): ComparisonUpdateCache {
  return { ai: new Map(), baseline: new Map() }
}

export function cacheComparisonUpdate(
  cache: ComparisonUpdateCache,
  update: StateUpdateMessage,
): ComparisonPair | null {
  if (update.method === 'ai') cache.ai.set(update.timestamp, update)
  else if (update.method) cache.baseline.set(update.timestamp, update)
  else return null

  const ai = cache.ai.get(update.timestamp)
  const baseline = cache.baseline.get(update.timestamp)
  if (!ai || !baseline) return null

  cache.ai.delete(update.timestamp)
  cache.baseline.delete(update.timestamp)
  return { ai, baseline }
}

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
  const { animation: animationEngine } = useAnimationRuntime()
  const socketRef = useRef<WebSocket | null>(null)
  const comparisonCacheRef = useRef<ComparisonUpdateCache>(createComparisonUpdateCache())
  const [message, setMessage] = useState<SimulationMessage | null>(null)
  const [stateUpdate, setStateUpdate] = useState<StateUpdateMessage | null>(null)
  const [comparisonPair, setComparisonPair] = useState<ComparisonPair | null>(null)
  const [stateHistory, setStateHistory] = useState<StateUpdateMessage[]>([])
  const [comparisonHistory, setComparisonHistory] = useState<ComparisonPair[]>([])
  const [controlState, setControlState] = useState<ControlAckMessage | null>(null)
  const [status, setStatus] = useState<WebSocketStatus>(path ? 'connecting' : 'disconnected')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)

  useEffect(() => {
    if (!path) {
      setStatus('disconnected')
      return
    }

    let active = true
    let reconnectTimer: number | null = null
    comparisonCacheRef.current = createComparisonUpdateCache()
    const requestedSpeed = Number(new URLSearchParams(path.split('?')[1] ?? '').get('speed') ?? 1)
    animationEngine.setKeyframeInterval(1000 / Math.max(0.25, requestedSpeed))
    animationEngine.setPaused(false)

    const connect = () => {
      if (!active) return
      setStatus('connecting')
      const socket = new WebSocket(websocketUrl(path))
      socketRef.current = socket

      socket.onopen = () => {
        animationEngine.setConnected(true)
        setStatus('connected')
        setErrorMessage(null)
      }
      socket.onmessage = (event) => {
        if (!active) return
        try {
          const parsed: unknown = JSON.parse(event.data)
          if (!isSimulationMessage(parsed)) throw new Error('Unsupported WebSocket message format')
          setMessage(parsed)
          if (parsed.type === 'state_update') {
            if (parsed.method) {
              const pair = cacheComparisonUpdate(comparisonCacheRef.current, parsed)
              if (pair) {
                animationEngine.pushComparison(pair.ai, pair.baseline)
                setComparisonPair(pair)
                setComparisonHistory((history) => [
                  ...history.filter((item) => item.ai.timestamp !== pair.ai.timestamp),
                  pair,
                ].sort((left, right) => left.ai.timestamp - right.ai.timestamp))
              }
            } else {
              animationEngine.pushTarget('single', parsed)
              setStateUpdate(parsed)
              setStateHistory((history) => [
                ...history.filter((item) => item.timestamp !== parsed.timestamp),
                parsed,
              ].sort((left, right) => left.timestamp - right.timestamp))
            }
          }
          if (parsed.type === 'control_ack') {
            setControlState(parsed)
            animationEngine.setPaused(!parsed.playing)
            animationEngine.setKeyframeInterval(1000 / parsed.speed)
          }
          if (parsed.type === 'error') {
            setErrorMessage(parsed.message)
            setStatus('error')
          }
          if (parsed.type === 'simulation_complete') {
            setCompleted(true)
          }
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to parse WebSocket message')
          setStatus('error')
        }
      }
      socket.onerror = () => {
        animationEngine.setConnected(false)
        setErrorMessage('Unable to connect to the simulation service. Confirm that the backend, scenario, and model are ready.')
        setStatus('error')
      }
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null
        if (!active) return
        animationEngine.setConnected(false)
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
  }, [animationEngine, autoReconnect, path])

  const sendControl = useCallback((action: ControlAction, speed?: number) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setErrorMessage('The simulation service is not connected')
      return false
    }
    socket.send(JSON.stringify({ type: 'control', action, ...(speed === undefined ? {} : { speed }) }))
    if (action === 'reset') {
      setStateUpdate(null)
      setComparisonPair(null)
      setStateHistory([])
      setComparisonHistory([])
      comparisonCacheRef.current = createComparisonUpdateCache()
      setCompleted(false)
      animationEngine.clear()
    }
    return true
  }, [animationEngine])

  const clearState = useCallback(() => {
    setMessage(null)
    setStateUpdate(null)
    setComparisonPair(null)
    setStateHistory([])
    setComparisonHistory([])
    comparisonCacheRef.current = createComparisonUpdateCache()
    setControlState(null)
    setErrorMessage(null)
    setCompleted(false)
    animationEngine.clear()
  }, [animationEngine])

  return {
    message,
    stateUpdate,
    comparisonPair,
    stateHistory,
    comparisonHistory,
    controlState,
    status,
    errorMessage,
    completed,
    sendControl,
    clearState,
  }
}
