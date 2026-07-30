import type { SimulationTransmission } from '../../types/simulation'

const MAX_VISUAL_LINKS = 100

export type LinkPhase = 'pending' | 'transmitting' | 'delivered'

export type LinkLifecycle = {
  phase: LinkPhase
  progress: number
}

export type CommunicationTone = 'ai' | 'baseline'

export type CommunicationVisualStyle = {
  color: string
  packetCount: number
  packetCycleMs: number
  lateralOffset: number
}

export function packetCountForBandwidth(bandwidthFraction: number): number {
  const bounded = Math.max(0, Math.min(1, Number.isFinite(bandwidthFraction)
    ? bandwidthFraction : 0))
  return Math.max(1, Math.min(3, Math.round(1 + bounded * 2)))
}

export function packetCycleForDelay(delayMs: number): number {
  const safeDelay = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0
  return Math.max(620, Math.min(1_750, safeDelay * 18))
}

export function communicationVisualStyle(
  tone: CommunicationTone,
  status: SimulationTransmission['status'],
  delayMs: number,
  bandwidthFraction: number,
  receiverLane: number,
  distance: number,
): CommunicationVisualStyle {
  const distanceBand = Math.min(5, Math.max(0, Math.floor(distance / 3.5)))
  const laneBand = Math.abs(receiverLane) % 4
  return {
    color: status === 'timeout' ? '#ff5669' : tone === 'ai' ? '#3de4c2' : '#d6a75d',
    packetCount: packetCountForBandwidth(bandwidthFraction),
    packetCycleMs: packetCycleForDelay(delayMs),
    // Baseline messages share lane/distance corridors so dense broadcasts read as bundles,
    // while AI links retain a smaller receiver-specific separation.
    lateralOffset: tone === 'baseline'
      ? 0.13 + laneBand * 0.055 + distanceBand * 0.018
      : 0.11 + laneBand * 0.045,
  }
}

export function linkLifecycleAt(index: number, total: number, revealProgress: number): LinkLifecycle {
  if (total <= 0) return { phase: 'pending', progress: 0 }
  const stagger = Math.min(0.72, index / Math.max(1, total - 1) * 0.72)
  const progress = Math.max(0, Math.min(1, (revealProgress - stagger) / 0.28))
  return {
    phase: progress <= 0 ? 'pending' : progress < 0.82 ? 'transmitting' : 'delivered',
    progress,
  }
}

export function aggregateDirectedTransmissions(
  messages: readonly SimulationTransmission[],
): SimulationTransmission[] {
  const byPair = new Map<string, SimulationTransmission>()
  messages.forEach((message) => {
    const key = `${message.from}\u0000${message.to}`
    const previous = byPair.get(key)
    if (!previous || message.status === 'timeout' || message.delay_ms > previous.delay_ms) {
      byPair.set(key, message)
    }
  })
  return [...byPair.values()].slice(0, MAX_VISUAL_LINKS)
}

export function orderTransmissionsByPriority(
  messages: readonly SimulationTransmission[],
  priorityByVehicle: Readonly<Record<string, number>> = {},
): SimulationTransmission[] {
  return aggregateDirectedTransmissions(messages).sort((left, right) => {
    const priorityDelta = (priorityByVehicle[right.to] ?? 0) - (priorityByVehicle[left.to] ?? 0)
    if (Math.abs(priorityDelta) > 1e-9) return priorityDelta
    return left.delay_ms - right.delay_ms || left.to.localeCompare(right.to)
  })
}
