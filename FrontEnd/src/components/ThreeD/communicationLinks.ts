import type { SimulationTransmission } from '../../types/simulation'

const MAX_VISUAL_LINKS = 100

export type LinkPhase = 'pending' | 'transmitting' | 'delivered'

export type LinkLifecycle = {
  phase: LinkPhase
  progress: number
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
