import type { StateUpdateMessage } from '../types/simulation'
import {
  coastVehicle,
  interpolatePhysics,
  type AnimatedVehicle,
} from './Interpolator'

export type AnimationChannel = 'single' | 'comparison-ai' | 'comparison-baseline'

export type AnimatedFrame = Omit<StateUpdateMessage, 'vehicles'> & {
  vehicles: AnimatedVehicle[]
  animationTimeMs: number
}

type FrameListener = (frame: AnimatedFrame) => void

type ChannelState = {
  raw: StateUpdateMessage
  from: AnimatedVehicle[]
  frame: AnimatedFrame
  startedAt: number
  durationMs: number
}

type AnimationScheduler = {
  now: () => number
  request: (callback: FrameRequestCallback) => number
  cancel: (handle: number) => void
}

const FRAME_INTERVAL_MS = 1000 / 60

function defaultScheduler(): AnimationScheduler | null {
  if (typeof window === 'undefined') return null
  return {
    now: () => performance.now(),
    request: (callback) => window.requestAnimationFrame(callback),
    cancel: (handle) => window.cancelAnimationFrame(handle),
  }
}

function animatedInitial(vehicle: StateUpdateMessage['vehicles'][number]): AnimatedVehicle {
  return { ...vehicle, motion: 'cruising', pitch: 0 }
}

function brakingVehicleIds(update: StateUpdateMessage): Set<string> {
  const ids = new Set<string>()
  for (const event of update.events) {
    if (!event.type.includes('brak') || update.vehicles.length === 0) continue
    const nearest = update.vehicles.reduce((best, vehicle) => {
      const distance = Math.hypot(vehicle.x - event.x, vehicle.y - event.y)
      return distance < best.distance ? { id: vehicle.id, distance } : best
    }, { id: '', distance: Number.POSITIVE_INFINITY })
    if (nearest.id) ids.add(nearest.id)
  }
  return ids
}

export class AnimationEngine {
  private readonly channels = new Map<AnimationChannel, ChannelState>()
  private readonly listeners = new Map<AnimationChannel, Set<FrameListener>>()
  private scheduler: AnimationScheduler | null
  private requestHandle: number | null = null
  private lastFrameAt: number | null = null
  private animationTimeMs = 0
  private keyframeIntervalMs = 1000
  private connected = true
  private paused = false
  private timeScale = 1
  private scaleTransition: { from: number; to: number; startedAt: number; durationMs: number } | null = null
  private replaySequence = 0

  constructor(scheduler: AnimationScheduler | null = defaultScheduler()) {
    this.scheduler = scheduler
  }

  setKeyframeInterval(intervalMs: number): void {
    this.keyframeIntervalMs = Math.min(4000, Math.max(150, intervalMs))
  }

  pushTarget(channel: AnimationChannel, update: StateUpdateMessage): void {
    const now = this.scheduler?.now() ?? this.animationTimeMs
    const previous = this.channels.get(channel)
    const previousById = new Map((previous?.frame.vehicles ?? []).map((vehicle) => [vehicle.id, vehicle]))
    const from = update.vehicles.map((vehicle) => previousById.get(vehicle.id) ?? animatedInitial(vehicle))
    const initialVehicles = update.vehicles.map((vehicle, index) => ({
      ...(from[index] ?? animatedInitial(vehicle)),
      status: vehicle.status,
    }))
    this.channels.set(channel, {
      raw: update,
      from,
      frame: { ...update, vehicles: initialVehicles, animationTimeMs: this.animationTimeMs },
      startedAt: this.animationTimeMs,
      durationMs: this.keyframeIntervalMs,
    })
    this.connected = true
    this.paused = false
    this.start(now)
  }

  pushComparison(ai: StateUpdateMessage, baseline: StateUpdateMessage): void {
    this.pushTarget('comparison-ai', ai)
    this.pushTarget('comparison-baseline', baseline)
  }

  replayMessages(channel: AnimationChannel, messages: StateUpdateMessage['messages']): void {
    const state = this.channels.get(channel)
    if (!state || messages.length === 0) return
    const timestamp = state.raw.timestamp + (++this.replaySequence / 1000)
    state.raw = { ...state.raw, timestamp, messages }
    state.frame = { ...state.frame, timestamp, messages }
  }

  subscribe(channel: AnimationChannel, listener: FrameListener): () => void {
    const listeners = this.listeners.get(channel) ?? new Set<FrameListener>()
    listeners.add(listener)
    this.listeners.set(channel, listeners)
    const frame = this.channels.get(channel)?.frame
    if (frame) listener(frame)
    this.start(this.scheduler?.now() ?? 0)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.listeners.delete(channel)
      this.stopIfIdle()
    }
  }

  getSnapshot(channel: AnimationChannel): AnimatedFrame | null {
    return this.channels.get(channel)?.frame ?? null
  }

  getVehicle(channel: AnimationChannel, vehicleId: string): AnimatedVehicle | null {
    return this.channels.get(channel)?.frame.vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null
  }

  setConnected(connected: boolean): void {
    this.connected = connected
    if (!connected) this.start(this.scheduler?.now() ?? 0)
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    if (!paused) this.start(this.scheduler?.now() ?? 0)
  }

  setTimeScale(scale: number, transitionMs = 0): void {
    const target = Math.min(5, Math.max(0.1, scale))
    if (transitionMs <= 0) {
      this.timeScale = target
      this.scaleTransition = null
      return
    }
    this.scaleTransition = {
      from: this.timeScale,
      to: target,
      startedAt: this.scheduler?.now() ?? 0,
      durationMs: transitionMs,
    }
  }

  getTimeScale(): number {
    return this.timeScale
  }

  clear(channel?: AnimationChannel): void {
    if (channel) this.channels.delete(channel)
    else this.channels.clear()
    this.stopIfIdle()
  }

  destroy(): void {
    if (this.requestHandle !== null && this.scheduler) this.scheduler.cancel(this.requestHandle)
    this.requestHandle = null
    this.channels.clear()
    this.listeners.clear()
  }

  advance(now: number): void {
    if (this.lastFrameAt === null) {
      this.lastFrameAt = now
      return
    }
    const realDelta = Math.min(100, Math.max(0, now - this.lastFrameAt))
    if (realDelta < FRAME_INTERVAL_MS * 0.9) return
    this.lastFrameAt = now
    this.updateScale(now)
    const scaledDelta = this.paused ? 0 : realDelta * this.timeScale
    this.animationTimeMs += scaledDelta

    for (const [channel, state] of this.channels) {
      const braking = brakingVehicleIds(state.raw)
      const elapsed = this.animationTimeMs - state.startedAt
      const amount = state.durationMs <= 0 ? 1 : Math.min(1, elapsed / state.durationMs)
      let vehicles = state.raw.vehicles.map((target, index) => interpolatePhysics(
        state.from[index] ?? target,
        target,
        amount,
        braking.has(target.id),
      ))
      if (!this.connected && !this.paused) {
        vehicles = state.frame.vehicles.map((vehicle) => coastVehicle(vehicle, scaledDelta / 1000))
      }
      state.frame = { ...state.raw, vehicles, animationTimeMs: this.animationTimeMs }
      for (const listener of this.listeners.get(channel) ?? []) listener(state.frame)
    }
  }

  private updateScale(now: number): void {
    if (!this.scaleTransition) return
    const progress = Math.min(1, (now - this.scaleTransition.startedAt) / this.scaleTransition.durationMs)
    const eased = progress * progress * (3 - 2 * progress)
    this.timeScale = this.scaleTransition.from
      + (this.scaleTransition.to - this.scaleTransition.from) * eased
    if (progress >= 1) this.scaleTransition = null
  }

  private start(now: number): void {
    if (!this.scheduler || this.requestHandle !== null || this.channels.size === 0) return
    if (this.lastFrameAt === null) this.lastFrameAt = now
    const loop = (timestamp: number) => {
      this.requestHandle = null
      this.advance(timestamp)
      if (this.channels.size > 0) this.requestHandle = this.scheduler?.request(loop) ?? null
    }
    this.requestHandle = this.scheduler.request(loop)
  }

  private stopIfIdle(): void {
    if (this.channels.size > 0 || this.requestHandle === null || !this.scheduler) return
    this.scheduler.cancel(this.requestHandle)
    this.requestHandle = null
    this.lastFrameAt = null
  }
}

export const animationEngine = new AnimationEngine()
