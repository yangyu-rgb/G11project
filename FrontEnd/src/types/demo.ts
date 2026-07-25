import type { ComparisonBaseline, SimulationEvent } from './simulation'

export type DemoScenario = {
  id: string
  title: string
  description: string
  scenario: string
  model: string
  mode: 'single' | 'comparison'
  baseline: ComparisonBaseline
  available: boolean
  missing: string[]
  events?: SimulationEvent[]
}
