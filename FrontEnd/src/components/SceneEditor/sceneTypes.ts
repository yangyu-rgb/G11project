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
    limitations.push('当前真实模型最多支持50辆车')
  }
  if (scenario.events.length > EDITOR_MODEL_LIMITS.events) {
    limitations.push('当前真实模型最多支持2个事件')
  }
  if (scenario.vehicles.length === 0) limitations.push('至少需要1辆车')
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
    throw new Error('JSON不是受支持的场景格式')
  }
  if (!Array.isArray(value.vehicles) || !Array.isArray(value.events)) {
    throw new Error('场景必须包含vehicles和events数组')
  }
  if (value.vehicles.length < 1 || value.vehicles.length > 100 || value.events.length > 5) {
    throw new Error('车辆数量必须为1–100，事件数量必须为0–5')
  }
  const vehicles = value.vehicles.map((item) => {
    if (!isRecord(item) || !safeId(item.id) || !finiteNumber(item.x) || !finiteNumber(item.y)
      || !finiteNumber(item.speed_kmh) || !finiteNumber(item.heading)
      || item.speed_kmh < 0 || item.speed_kmh > 150 || item.heading < 0 || item.heading >= 360) {
      throw new Error('车辆字段或数值范围不合法')
    }
    return item as EditorVehicle
  })
  const allowedTypes: EditorEventType[] = ['emergency_braking', 'obstacle', 'collision_warning']
  const events = value.events.map((item) => {
    if (!isRecord(item) || !safeId(item.id) || !allowedTypes.includes(item.type as EditorEventType)
      || !finiteNumber(item.x) || !finiteNumber(item.y) || !finiteNumber(item.timestamp)
      || !finiteNumber(item.severity) || item.timestamp < 0 || item.timestamp > 9
      || item.severity < 0 || item.severity > 1) {
      throw new Error('事件字段或数值范围不合法')
    }
    const source = item.source_vehicle_id
    const before = item.pre_brake_speed_kmh
    const after = item.post_brake_speed_kmh
    const hasIncidentData = source !== undefined || before !== undefined || after !== undefined
    if (hasIncidentData && (!safeId(source) || !finiteNumber(before) || !finiteNumber(after)
      || before < 0 || before > 150 || after < 0 || after >= before)) {
      throw new Error('事故车辆或减速参数不合法')
    }
    return item as EditorEvent
  })
  if (new Set(vehicles.map((item) => item.id)).size !== vehicles.length
    || new Set(events.map((item) => item.id)).size !== events.length) {
    throw new Error('车辆和事件ID必须各自唯一')
  }
  return { schema_version: 1, name: value.name.slice(0, 80), vehicles, events }
}
