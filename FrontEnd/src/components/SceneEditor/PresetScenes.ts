import type { EditorScenario, EditorVehicle } from './sceneTypes'

function vehicle(id: number, x: number, y: number, heading = 90): EditorVehicle {
  return { id: `vehicle_${String(id).padStart(3, '0')}`, x, y, speed_kmh: 60, heading }
}

const congestionVehicles = Array.from({ length: 100 }, (_, index) => (
  vehicle(index, 900 + (index % 25) * 34, 420 + Math.floor(index / 25) * 12)
))

const multiEventVehicles = Array.from({ length: 40 }, (_, index) => (
  vehicle(index, 500 + (index % 20) * 190, 440 + Math.floor(index / 20) * 120)
))

const boundaryVehicles = Array.from({ length: 24 }, (_, index) => {
  const angle = (index / 24) * Math.PI * 2
  return vehicle(
    index,
    2500 + Math.cos(angle) * 300,
    500 + Math.sin(angle) * 300,
    ((angle * 180) / Math.PI + 180) % 360,
  )
})

export const PRESET_SCENES: EditorScenario[] = [
  {
    schema_version: 1,
    name: '极端拥堵',
    vehicles: congestionVehicles,
    events: [{
      id: 'event_congestion', type: 'obstacle', x: 1300, y: 440,
      timestamp: 2, severity: 0.95,
    }],
  },
  {
    schema_version: 1,
    name: '多事件冲突',
    vehicles: multiEventVehicles,
    events: Array.from({ length: 5 }, (_, index) => ({
      id: `event_${index}`,
      type: (['emergency_braking', 'obstacle', 'collision_warning'] as const)[index % 3],
      x: 900 + index * 700,
      y: index % 2 === 0 ? 470 : 560,
      timestamp: index + 1,
      severity: 0.9,
    })),
  },
  {
    schema_version: 1,
    name: '300米边界测试',
    vehicles: boundaryVehicles,
    events: [{
      id: 'event_boundary', type: 'emergency_braking', x: 2500, y: 500,
      timestamp: 2, severity: 0.85,
    }],
  },
]

export const DEFAULT_EDITOR_SCENARIO: EditorScenario = {
  schema_version: 1,
  name: '自定义场景',
  vehicles: [vehicle(0, 1800, -4.8), vehicle(1, 2050, -8)],
  events: [{
    id: 'event_0', type: 'emergency_braking', x: 2000, y: -4.8,
    timestamp: 2, severity: 0.9,
  }],
}
