import type { StateUpdateMessage } from '../types/simulation'
import {
  coastVehicle,
  interpolateTrajectory,
  predictVehicle,
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
  previousTimestamp: number
  keyframes: StateUpdateMessage[]
  replay: ReplayTimelineConfig | null
  messageOverride: { messages: StateUpdateMessage['messages']; timestamp: number } | null
}

export type ReplayTimelineConfig = {
  durationMs: number
  anchorTimestamp?: number
  anchorAtMs?: number
}

type AnimationScheduler = {
  now: () => number
  request: (callback: FrameRequestCallback) => number
  cancel: (handle: number) => void
}

const FRAME_INTERVAL_MS = 1000 / 60
const MAX_LIVE_EXTRAPOLATION_MS = 500

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
  private replayElapsedMs = 0

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
      previousTimestamp: previous?.raw.timestamp ?? update.timestamp,
      keyframes: appendKeyframe(previous?.keyframes ?? [], update),
      replay: null,
      messageOverride: previous?.messageOverride ?? null,
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
    state.messageOverride = { messages, timestamp }
    state.frame = { ...state.frame, timestamp, messages }
  }

  loadReplay(
    channel: AnimationChannel,
    frames: readonly StateUpdateMessage[],
    config: ReplayTimelineConfig,
  ): void {
    const keyframes = [...frames].sort((left, right) => left.timestamp - right.timestamp)
      .filter((frame, index, ordered) => index === 0 || frame.timestamp !== ordered[index - 1].timestamp)
    if (keyframes.length < 2) return
    const initial = keyframes[0]
    const vehicles = initial.vehicles.map(animatedInitial)
    this.channels.set(channel, {
      raw: initial,
      from: vehicles,
      frame: { ...initial, vehicles, animationTimeMs: this.animationTimeMs },
      startedAt: this.animationTimeMs,
      durationMs: this.keyframeIntervalMs,
      previousTimestamp: initial.timestamp,
      keyframes,
      replay: {
        durationMs: Math.max(1, config.durationMs),
        anchorTimestamp: config.anchorTimestamp,
        anchorAtMs: config.anchorAtMs,
      },
      messageOverride: null,
    })
    this.replayElapsedMs = 0
    this.start(this.scheduler?.now() ?? 0)
  }

  setReplayElapsed(elapsedMs: number): void {
    this.replayElapsedMs = Math.max(0, elapsedMs)
  }

  getReplayElapsed(): number {
    return this.replayElapsedMs
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
    else {
      this.channels.clear()
      this.replayElapsedMs = 0
    }
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
    if (!this.paused && [...this.channels.values()].some((state) => state.replay)) {
      this.replayElapsedMs += scaledDelta
    }

    for (const [channel, state] of this.channels) {
      if (state.replay) {
        state.frame = sampleReplay(state, this.replayElapsedMs, this.animationTimeMs)
        for (const listener of this.listeners.get(channel) ?? []) listener(state.frame)
        continue
      }
      const braking = brakingVehicleIds(state.raw)
      const elapsed = this.animationTimeMs - state.startedAt
      const amount = state.durationMs <= 0 ? 1 : Math.min(1, elapsed / state.durationMs)
      const simulationDuration = Math.max(
        0.001,
        state.raw.timestamp - state.previousTimestamp,
      )
      let vehicles = state.raw.vehicles.map((target, index) => interpolateTrajectory(
        state.from[index] ?? target,
        target,
        amount,
        simulationDuration,
        braking.has(target.id),
      ))
      if (elapsed > state.durationMs && elapsed <= state.durationMs + MAX_LIVE_EXTRAPOLATION_MS) {
        const rate = simulationDuration / Math.max(0.001, state.durationMs / 1000)
        vehicles = vehicles.map((vehicle) => predictVehicle(
          vehicle,
          (elapsed - state.durationMs) / 1000,
          rate,
        ))
      }
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

function appendKeyframe(
  frames: readonly StateUpdateMessage[],
  update: StateUpdateMessage,
): StateUpdateMessage[] {
  return [...frames.filter((frame) => frame.timestamp !== update.timestamp), update]
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-16)
}

function replayTimestamp(
  frames: readonly StateUpdateMessage[],
  elapsedMs: number,
  config: ReplayTimelineConfig,
): number {
  const first = frames[0].timestamp
  const last = frames[frames.length - 1].timestamp
  const progressMs = Math.min(config.durationMs, Math.max(0, elapsedMs))
  const anchorTimestamp = config.anchorTimestamp
  const anchorAtMs = config.anchorAtMs
  if (anchorTimestamp === undefined || anchorAtMs === undefined
    || anchorTimestamp <= first || anchorTimestamp >= last
    || anchorAtMs <= 0 || anchorAtMs >= config.durationMs) {
    return first + (last - first) * (progressMs / config.durationMs)
  }
  if (progressMs <= anchorAtMs) {
    return first + (anchorTimestamp - first) * (progressMs / anchorAtMs)
  }
  return anchorTimestamp + (last - anchorTimestamp)
    * ((progressMs - anchorAtMs) / (config.durationMs - anchorAtMs))
}

function sampleReplay(
  state: ChannelState,
  elapsedMs: number,
  animationTimeMs: number,
): AnimatedFrame {
  const timestamp = replayTimestamp(state.keyframes, elapsedMs, state.replay as ReplayTimelineConfig)
  let upperIndex = state.keyframes.findIndex((frame) => frame.timestamp >= timestamp)
  if (upperIndex < 0) upperIndex = state.keyframes.length - 1
  const lowerIndex = Math.max(0, upperIndex - 1)
  const lower = state.keyframes[lowerIndex]
  const upper = state.keyframes[upperIndex]
  const duration = Math.max(0.001, upper.timestamp - lower.timestamp)
  const amount = lower === upper ? 1 : (timestamp - lower.timestamp) / duration
  const lowerById = new Map(lower.vehicles.map((vehicle) => [vehicle.id, vehicle]))
  const vehicles = upper.vehicles.map((vehicle) => {
    const previous = lowerById.get(vehicle.id) ?? vehicle
    return interpolateTrajectory(previous, vehicle, amount, duration, false)
  })
  const base = amount < 0.5 ? lower : upper
  const override = state.messageOverride
  state.raw = base
  return {
    ...base,
    timestamp: override?.timestamp ?? timestamp,
    messages: override?.messages ?? base.messages,
    vehicles,
    animationTimeMs,
  }
}
