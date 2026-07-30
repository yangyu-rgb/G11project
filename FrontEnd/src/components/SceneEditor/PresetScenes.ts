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
    name: 'Extreme Congestion',
    vehicles: congestionVehicles,
    events: [{
      id: 'event_congestion', type: 'obstacle', x: 1300, y: 440,
      timestamp: 2, severity: 0.95,
    }],
  },
  {
    schema_version: 1,
    name: 'Multi-Incident Conflict',
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
    name: '300 m Boundary Test',
    vehicles: boundaryVehicles,
    events: [{
      id: 'event_boundary', type: 'emergency_braking', x: 2500, y: 500,
      timestamp: 2, severity: 0.85,
    }],
  },
]

export const DEFAULT_EDITOR_SCENARIO: EditorScenario = {
  schema_version: 1,
  name: 'Custom Scenario',
  vehicles: [vehicle(0, 1800, -4.8), vehicle(1, 2050, -8)],
  events: [{
    id: 'event_0', type: 'emergency_braking', x: 2000, y: -4.8,
    timestamp: 2, severity: 0.9,
  }],
}

const presentationLanes = [-8, -4.8, -1.6] as const
const presentationLaneOffsets = [0, 23, 46] as const
export const PRESENTATION_ROW_SPACING_METERS = 70
const PRESENTATION_START_X_METERS = 650

export type PresentationDensity = 'light' | 'medium' | 'dense'

export const PRESENTATION_DENSITIES: Record<PresentationDensity, {
  label: string
  vehicleCount: 30 | 36 | 50
  description: string
}> = {
  light: { label: 'Light', vehicleCount: 30, description: '30 vehicles · Low traffic pressure' },
  medium: { label: 'Medium', vehicleCount: 36, description: '36 vehicles · Moderate traffic pressure' },
  dense: { label: 'Dense', vehicleCount: 50, description: '50 vehicles · Recommended for presentation' },
}

export function buildHighwayPresentationScenario(
  density: PresentationDensity = 'dense',
): EditorScenario {
  const setting = PRESENTATION_DENSITIES[density]
  return {
    schema_version: 1,
    name: `Highway Selective V2X Demo-${setting.label}-${setting.vehicleCount} Vehicles`,
    vehicles: Array.from({ length: setting.vehicleCount }, (_, index) => {
      const lane = index % presentationLanes.length
      const lanePosition = Math.floor(index / presentationLanes.length)
      return vehicle(
        index,
        PRESENTATION_START_X_METERS + lanePosition * PRESENTATION_ROW_SPACING_METERS
          + presentationLaneOffsets[lane],
        presentationLanes[lane],
      )
    }).map((item, index) => ({ ...item, speed_kmh: 88 + (index % 5) * 4 })),
    events: [],
  }
}

export function recommendedIncidentVehicleId(scenario: EditorScenario): string {
  const outerLaneVehicles = scenario.vehicles
    .filter((item) => item.y === presentationLanes[0])
    .sort((left, right) => left.x - right.x)
  const targetIndex = Math.floor(Math.max(0, outerLaneVehicles.length - 1) * 0.75)
  return outerLaneVehicles[targetIndex]?.id ?? scenario.vehicles[0]?.id ?? ''
}

export const HIGHWAY_PRESENTATION_SCENARIO = buildHighwayPresentationScenario('dense')

export function withEmergencyIncident(
  scenario: EditorScenario,
  vehicleId: string,
): EditorScenario {
  const source = scenario.vehicles.find((vehicleItem) => vehicleItem.id === vehicleId)
  if (!source) throw new Error('Select a valid incident vehicle')
  return {
    ...scenario,
    name: `${scenario.name}-${vehicleId}`,
    vehicles: scenario.vehicles.map((vehicleItem) => (
      vehicleItem.id === vehicleId ? { ...vehicleItem, speed_kmh: 96 } : vehicleItem
    )),
    events: [{
      id: 'event_emergency_braking',
      type: 'emergency_braking',
      x: source.x,
      y: source.y,
      timestamp: 2,
      severity: 0.9,
      source_vehicle_id: vehicleId,
      pre_brake_speed_kmh: 96,
      post_brake_speed_kmh: 18,
    }],
  }
}
