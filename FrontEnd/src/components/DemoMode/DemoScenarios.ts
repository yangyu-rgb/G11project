import type { DemoScenario } from '../../types/demo'

export type { DemoScenario } from '../../types/demo'

export const FALLBACK_DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: 'highway-braking', title: '高速急刹', description: 'AI调度与全量广播对比',
    scenario: 'experiments/test_scenario', model: 'experiments/test_ppo/model.zip',
    mode: 'comparison', baseline: 'broadcast', available: true, missing: [], events: [],
  },
]
