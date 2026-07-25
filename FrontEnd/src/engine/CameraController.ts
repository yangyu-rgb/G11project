import type { SimulationEvent, StateUpdateMessage } from '../types/simulation'

export type CameraPhase = 'idle' | 'event_detected' | 'ai_processing' | 'message_delivered' | 'complete'

export type CameraCommand = {
  id: number
  phase: CameraPhase
  visualization: '2d' | '3d'
  event?: SimulationEvent
  global: boolean
  durationMs: number
}

type CameraListener = (command: CameraCommand) => void

export class CameraController {
  private listeners = new Set<CameraListener>()
  private phase: CameraPhase = 'idle'
  private enabled = true
  private overridden = false
  private commandId = 0
  private eventKey: string | null = null
  private focusTimer: ReturnType<typeof setTimeout> | null = null
  private deliveryTimer: ReturnType<typeof setTimeout> | null = null

  subscribe(listener: CameraListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (enabled) this.overridden = false
  }

  isEnabled(): boolean {
    return this.enabled
  }

  userOverride(): void {
    this.overridden = true
  }

  reset(): void {
    if (this.focusTimer) clearTimeout(this.focusTimer)
    if (this.deliveryTimer) clearTimeout(this.deliveryTimer)
    this.focusTimer = null
    this.deliveryTimer = null
    this.phase = 'idle'
    this.overridden = false
    this.eventKey = null
    this.emit({ phase: 'idle', visualization: '2d', global: true, durationMs: 1000 })
  }

  observe(state: StateUpdateMessage | null, complete = false): void {
    if (!this.enabled || this.overridden) return
    if (complete && this.phase !== 'complete') {
      this.phase = 'complete'
      this.emit({ phase: 'complete', visualization: '2d', global: true, durationMs: 1200 })
      return
    }
    if (!state) return
    const event = state.events[0]
    const delivered = state.messages.some((message) => message.status === 'success')
    if (event) {
      const key = `${event.id}:${event.timestamp}`
      if (key !== this.eventKey) {
        this.focusEvent(event)
        if (delivered) this.scheduleGlobalView()
        return
      }
    }
    if (delivered && this.phase !== 'message_delivered') {
      if (this.phase === 'event_detected' || this.phase === 'ai_processing') {
        this.scheduleGlobalView()
        return
      }
      this.phase = 'message_delivered'
      this.emit({ phase: 'message_delivered', visualization: '3d', global: true, durationMs: 1200 })
    } else if (this.phase === 'event_detected') {
      this.phase = 'ai_processing'
    }
  }

  focusEvent(event: SimulationEvent): void {
    if (!this.enabled || this.overridden) return
    this.eventKey = `${event.id}:${event.timestamp}`
    this.phase = 'event_detected'
    this.emit({ phase: 'event_detected', visualization: '2d', event, global: false, durationMs: 550 })
    if (this.focusTimer) clearTimeout(this.focusTimer)
    if (this.deliveryTimer) clearTimeout(this.deliveryTimer)
    this.deliveryTimer = null
    this.focusTimer = setTimeout(() => {
      this.focusTimer = null
      if (!this.enabled || this.overridden) return
      this.emit({ phase: 'event_detected', visualization: '3d', event, global: false, durationMs: 1300 })
    }, 650)
  }

  showGlobal(): void {
    if (!this.enabled || this.overridden) return
    this.phase = 'message_delivered'
    this.emit({ phase: 'message_delivered', visualization: '3d', global: true, durationMs: 1200 })
  }

  private scheduleGlobalView(): void {
    if (this.deliveryTimer) return
    this.deliveryTimer = setTimeout(() => {
      this.deliveryTimer = null
      this.showGlobal()
    }, 2200)
  }

  private emit(command: Omit<CameraCommand, 'id'>): void {
    const value = { ...command, id: ++this.commandId }
    for (const listener of this.listeners) listener(value)
  }
}
