import type { SimulationEvent, SimulationVehicle } from '../../types/simulation'

export type EditorEventType = 'emergency_braking' | 'obstacle' | 'collision_warning'
export type EditorTool = 'select' | 'vehicle' | 'event'

export type EditorVehicle = {
  id: string
  x: number
  y: number
  speed_kmh: number
  heading: number
}

export type EditorEvent = {
  id: string
  type: EditorEventType
  x: number
  y: number
  timestamp: number
  severity: number
  source_vehicle_id?: string
  pre_brake_speed_kmh?: number
  post_brake_speed_kmh?: number
}

export type EditorScenario = {
  schema_version: 1
  name: string
  vehicles: EditorVehicle[]
  events: EditorEvent[]
}

export type EditorScenarioResponse = {
  scenario_ref: string
  vehicle_count: number
  event_count: number
  ai_runnable: boolean
  limitations: string[]
}

export const EDITOR_MODEL_LIMITS = { vehicles: 50, events: 2 } as const

export function editorVehicleToSimulation(vehicle: EditorVehicle): SimulationVehicle {
  const speedMps = vehicle.speed_kmh / 3.6
  const radians = (vehicle.heading * Math.PI) / 180
  return {
    id: vehicle.id,
    x: vehicle.x,
    y: vehicle.y,
    vx: Math.sin(radians) * speedMps,
    vy: Math.cos(radians) * speedMps,
    heading: vehicle.heading,
    status: 'normal',
  }
}

export function editorEventToSimulation(event: EditorEvent): SimulationEvent {
  return { ...event }
}

export function editorLimitations(scenario: EditorScenario): string[] {
  const limitations: string[] = []
  if (scenario.vehicles.length > EDITOR_MODEL_LIMITS.vehicles) {
    limitations.push('The production model currently supports up to 50 vehicles')
  }
  if (scenario.events.length > EDITOR_MODEL_LIMITS.events) {
    limitations.push('The production model currently supports up to two incidents')
  }
  if (scenario.vehicles.length === 0) limitations.push('At least one vehicle is required')
  return limitations
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
}

export function parseEditorScenario(value: unknown): EditorScenario {
  if (!isRecord(value) || value.schema_version !== 1 || typeof value.name !== 'string') {
    throw new Error('The JSON does not match a supported scenario format')
  }
  if (!Array.isArray(value.vehicles) || !Array.isArray(value.events)) {
    throw new Error('The scenario must contain vehicles and events arrays')
  }
  if (value.vehicles.length < 1 || value.vehicles.length > 100 || value.events.length > 5) {
    throw new Error('Vehicle count must be 1–100 and incident count must be 0–5')
  }
  const vehicles = value.vehicles.map((item) => {
    if (!isRecord(item) || !safeId(item.id) || !finiteNumber(item.x) || !finiteNumber(item.y)
      || !finiteNumber(item.speed_kmh) || !finiteNumber(item.heading)
      || item.speed_kmh < 0 || item.speed_kmh > 150 || item.heading < 0 || item.heading >= 360) {
      throw new Error('Vehicle fields or numeric ranges are invalid')
    }
    return item as EditorVehicle
  })
  const allowedTypes: EditorEventType[] = ['emergency_braking', 'obstacle', 'collision_warning']
  const events = value.events.map((item) => {
    if (!isRecord(item) || !safeId(item.id) || !allowedTypes.includes(item.type as EditorEventType)
      || !finiteNumber(item.x) || !finiteNumber(item.y) || !finiteNumber(item.timestamp)
      || !finiteNumber(item.severity) || item.timestamp < 0 || item.timestamp > 9
      || item.severity < 0 || item.severity > 1) {
      throw new Error('Incident fields or numeric ranges are invalid')
    }
    const source = item.source_vehicle_id
    const before = item.pre_brake_speed_kmh
    const after = item.post_brake_speed_kmh
    const hasIncidentData = source !== undefined || before !== undefined || after !== undefined
    if (hasIncidentData && (!safeId(source) || !finiteNumber(before) || !finiteNumber(after)
      || before < 0 || before > 150 || after < 0 || after >= before)) {
      throw new Error('Incident vehicle or braking parameters are invalid')
    }
    return item as EditorEvent
  })
  if (new Set(vehicles.map((item) => item.id)).size !== vehicles.length
    || new Set(events.map((item) => item.id)).size !== events.length) {
    throw new Error('Vehicle and incident IDs must each be unique')
  }
  return { schema_version: 1, name: value.name.slice(0, 80), vehicles, events }
}
