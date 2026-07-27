import { editorVehicleToSimulation, type EditorScenario } from '../SceneEditor/sceneTypes'
import type { ComparisonPair, StateUpdateMessage } from '../../types/simulation'

const MINIMUM_GAP_METERS = 8

function constrainedVehicles(scenario: EditorScenario, sourceId: string, timestamp: number) {
  const vehicles = scenario.vehicles.map((vehicle) => {
    const initialSpeed = vehicle.speed_kmh / 3.6
    const brakingProgress = vehicle.id === sourceId && timestamp > 2
      ? Math.min(1, (timestamp - 2) / 2) : 0
    const speed = vehicle.id === sourceId
      ? initialSpeed + (18 / 3.6 - initialSpeed) * brakingProgress
      : initialSpeed
    const distance = vehicle.id === sourceId && timestamp > 2
      ? initialSpeed * 2 + ((initialSpeed + speed) / 2) * (timestamp - 2)
      : initialSpeed * timestamp
    const simulation = editorVehicleToSimulation(vehicle)
    return { ...simulation, x: vehicle.x + distance, vx: speed }
  })
  const lanes = new Map<number, typeof vehicles>()
  for (const vehicle of vehicles) {
    const lane = Math.round(vehicle.y * 10)
    lanes.set(lane, [...(lanes.get(lane) ?? []), vehicle])
  }
  for (const laneVehicles of lanes.values()) {
    laneVehicles.sort((left, right) => right.x - left.x)
    for (let index = 1; index < laneVehicles.length; index += 1) {
      const leader = laneVehicles[index - 1]
      const follower = laneVehicles[index]
      if (leader.x - follower.x < MINIMUM_GAP_METERS) follower.x = leader.x - MINIMUM_GAP_METERS
    }
  }
  return vehicles
}

function update(
  scenario: EditorScenario,
  sourceId: string,
  timestamp: number,
  method: 'ai' | 'broadcast',
): StateUpdateMessage {
  const vehicles = constrainedVehicles(scenario, sourceId, timestamp)
  const source = vehicles.find((vehicle) => vehicle.id === sourceId) as typeof vehicles[number]
  const active = timestamp === 2
  const candidates = vehicles.filter((vehicle) => (
    vehicle.id !== sourceId && Math.hypot(vehicle.x - source.x, vehicle.y - source.y) <= 300
  ))
  const selected = method === 'broadcast'
    ? vehicles.filter((vehicle) => vehicle.id !== sourceId)
    : vehicles.filter((vehicle) => {
      const behind = source.x - vehicle.x
      const laneDelta = Math.abs(source.y - vehicle.y)
      return vehicle.id !== sourceId && behind > 0
        && ((laneDelta < 1.6 && behind <= 300) || (laneDelta < 4.9 && behind <= 150))
    })
  const selectedIds = active ? selected.map((vehicle) => vehicle.id) : []
  return {
    type: 'state_update',
    method,
    timestamp,
    vehicles: vehicles.map((vehicle) => ({
      ...vehicle,
      status: active && selectedIds.includes(vehicle.id) ? 'receiving'
        : active && vehicle.id === sourceId ? 'sending' : 'normal',
    })),
    events: active ? [{
      id: 'event_emergency_braking',
      type: 'emergency_brake',
      x: source.x,
      y: source.y,
      timestamp: 2,
      severity: 0.9,
    }] : [],
    messages: active ? selectedIds.map((vehicleId) => ({
      from: sourceId,
      to: vehicleId,
      status: 'success' as const,
      delay_ms: 0,
    })) : [],
    metrics: { avg_delay_ms: 0, delivery_rate: 0, comm_overhead: 0 },
    attention_weights: [],
    decision: {
      selected_receivers: selectedIds,
      selected_vehicles: selectedIds,
      priority: 'high',
      bandwidth_allocation: selectedIds.map(() => 0),
      candidate_vehicles: candidates.map((vehicle) => ({
        id: vehicle.id,
        distance_m: Math.hypot(vehicle.x - source.x, vehicle.y - source.y),
        status: selectedIds.includes(vehicle.id) ? 'selected' : 'candidate',
      })),
      selection_reason: Object.fromEntries(selectedIds.map((id) => [id, method === 'ai'
        ? '规则筛选' : '全量广播'])),
    },
  }
}

export function buildFallbackComparison(
  scenario: EditorScenario,
  sourceId: string,
): ComparisonPair[] {
  return Array.from({ length: 10 }, (_, timestamp) => ({
    ai: update(scenario, sourceId, timestamp, 'ai'),
    baseline: update(scenario, sourceId, timestamp, 'broadcast'),
  }))
}
