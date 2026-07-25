import type { ComparisonBaseline } from '../../types/simulation'
import type { SimulationEvent } from '../../types/simulation'

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

export const FALLBACK_DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: 'highway-braking', title: '高速急刹', description: 'AI调度与全量广播对比',
    scenario: 'experiments/test_scenario', model: 'experiments/test_ppo/model.zip',
    mode: 'comparison', baseline: 'broadcast', available: true, missing: [], events: [],
  },
]
