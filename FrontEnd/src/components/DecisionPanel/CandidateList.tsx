import type { SimulationDecision } from '../../types/simulation'

type CandidateListProps = { decision: SimulationDecision | null }

const reasonLabels: Record<string, string> = {
  high_attention: '高注意力',
  critical_distance: '关键距离',
  policy_selected: '策略选择',
  broadcast: '广播基线',
  urgency_priority: '紧急度优先',
}

const statusLabels: Record<string, string> = {
  candidate: '候选',
  normal: '候选',
  selected: '已选择',
  sending: '发送中',
  receiving: '接收中',
}

export function CandidateList({ decision }: CandidateListProps) {
  const candidates = decision?.candidate_vehicles ?? []
  const selected = new Set(
    (decision?.selected_vehicles ?? decision?.selected_receivers ?? []).map(String),
  )
  const reasons = decision?.selection_reason ?? {}

  if (candidates.length === 0) {
    return <p className="panel-empty">当前事件300米范围内没有候选车辆。</p>
  }

  return (
    <ul className="candidate-list" aria-label="候选车辆列表">
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
                {isSelected ? '已选择' : statusLabels[candidate.status] ?? candidate.status}
              </span>
              {reason && <small>{reasonLabels[reason] ?? reason}</small>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
