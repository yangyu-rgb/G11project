import type { ComparisonBaseline } from '../../types/simulation'

export type BaselineDefinition = {
  id: ComparisonBaseline
  label: string
  shortLabel: string
  description: string
  rule: string
}

export const BASELINE_DEFINITIONS: readonly BaselineDefinition[] = [
  {
    id: 'broadcast',
    label: 'Broadcast',
    shortLabel: 'BROADCAST',
    description: 'Sends the message to every non-incident vehicle in the communication domain.',
    rule: 'All non-sender vehicles',
  },
  {
    id: 'distance',
    label: 'Fixed Radius',
    shortLabel: 'DISTANCE · 300 m',
    description: 'Notifies every vehicle within 300 m using fixed high priority and 100% total bandwidth.',
    rule: 'Euclidean distance ≤ 300 m · Fixed resources',
  },
  {
    id: 'urgency',
    label: 'Urgency Scheduling',
    shortLabel: 'URGENCY',
    description: 'Uses the same 300 m receiver set while adapting priority and bandwidth to incident severity.',
    rule: 'Same distance filter · Severity-based resources',
  },
] as const

export function baselineDefinition(method: ComparisonBaseline | undefined): BaselineDefinition {
  return BASELINE_DEFINITIONS.find((item) => item.id === method) ?? BASELINE_DEFINITIONS[0]
}
