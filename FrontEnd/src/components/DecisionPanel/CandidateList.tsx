import type { SimulationDecision } from '../../types/simulation'

type CandidateListProps = { decision: SimulationDecision | null }

const reasonLabels: Record<string, string> = {
  high_attention: 'High attention',
  critical_distance: 'Critical distance',
  policy_selected: 'Policy selected',
  broadcast: 'Broadcast baseline',
  urgency_priority: 'Urgency priority',
}

const statusLabels: Record<string, string> = {
  candidate: 'Candidate',
  normal: 'Candidate',
  selected: 'Selected',
  sending: 'Sending',
  receiving: 'Receiving',
}

export function CandidateList({ decision }: CandidateListProps) {
  const candidates = decision?.candidate_vehicles ?? []
  const selected = new Set(
    (decision?.selected_vehicles ?? decision?.selected_receivers ?? []).map(String),
  )
  const reasons = decision?.selection_reason ?? {}

  if (candidates.length === 0) {
    return <p className="panel-empty">No candidate vehicles are within 300 m of the current incident.</p>
  }

  return (
    <ul className="candidate-list" aria-label="Candidate vehicle list">
      {candidates.map((candidate) => {
        const candidateId = String(candidate.id)
        const isSelected = selected.has(candidateId)
        const reason = reasons[candidate.id]
        return (
          <li key={candidateId} className={isSelected ? 'candidate candidate--selected' : 'candidate'}>
            <div>
              <strong>{candidate.id}</strong>
              <span>{candidate.distance_m.toFixed(1)} m</span>
            </div>
            <div className="candidate-state">
              <span className={`candidate-badge${isSelected ? ' candidate-badge--selected' : ''}`}>
                {isSelected ? 'Selected' : statusLabels[candidate.status] ?? candidate.status}
              </span>
              {reason && <small>{reasonLabels[reason] ?? reason}</small>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
