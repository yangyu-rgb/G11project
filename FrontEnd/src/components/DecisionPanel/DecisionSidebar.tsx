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
          <h2 id="decision-heading">Decision Process</h2>
        </div>
        <button
          type="button"
          className="collapse-button"
          aria-expanded={expanded}
          aria-controls="decision-sidebar-content"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      <div id="decision-sidebar-content" hidden={!expanded}>
        <section className="decision-section" aria-labelledby="candidate-heading">
          <h3 id="candidate-heading">Candidates Within 300 m</h3>
          <CandidateList decision={decision} />
        </section>
        <section className="decision-section" aria-labelledby="resource-heading">
          <h3 id="resource-heading">Resource Allocation</h3>
          <ResourceChart decision={decision} />
        </section>
        <p className="decision-explainer">
          “Relative attention” indicates the model's relative weighting of the current input. It is an interpretive cue, not a causal claim.
        </p>
      </div>
    </aside>
  )
}
