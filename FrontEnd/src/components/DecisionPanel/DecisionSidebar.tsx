import { useState } from 'react'

import type { SimulationDecision } from '../../types/simulation'
import { CandidateList } from './CandidateList'
import { ResourceChart } from './ResourceChart'

type DecisionSidebarProps = { decision: SimulationDecision | null }

export function DecisionSidebar({ decision }: DecisionSidebarProps) {
  const [expanded, setExpanded] = useState(true)

  return (
    <aside className={`decision-sidebar${expanded ? '' : ' decision-sidebar--collapsed'}`} aria-labelledby="decision-heading">
      <div className="decision-sidebar-header">
        <div>
          <p className="eyebrow">PPO DECISION</p>
          <h2 id="decision-heading">决策过程</h2>
        </div>
        <button
          type="button"
          className="collapse-button"
          aria-expanded={expanded}
          aria-controls="decision-sidebar-content"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? '收起' : '展开'}
        </button>
      </div>
      <div id="decision-sidebar-content" hidden={!expanded}>
        <section className="decision-section" aria-labelledby="candidate-heading">
          <h3 id="candidate-heading">300米内候选车辆</h3>
          <CandidateList decision={decision} />
        </section>
        <section className="decision-section" aria-labelledby="resource-heading">
          <h3 id="resource-heading">资源分配</h3>
          <ResourceChart decision={decision} />
        </section>
        <p className="decision-explainer">
          “相对注意力”表示模型在当前输入中给予的相对权重，用于解释选择线索，不代表因果关系。
        </p>
      </div>
    </aside>
  )
}
