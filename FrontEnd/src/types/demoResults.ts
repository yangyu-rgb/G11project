export type MetricEstimate = {
  mean: number
  std: number
  ci95: [number, number]
  count: number
}

export type MethodMetricSummary = Record<string, MetricEstimate>

export type EvidenceProvenance = {
  model_sha256: string | null
  commit: string | null
  run_mode: string | null
  dirty: boolean
  artifacts: string[]
}

export type SignificanceResult = {
  p_value?: number
  holm_adjusted_p?: number
  significant?: boolean
  ai_better?: boolean
}

export type DemoResultsSummary = {
  status: 'ready' | 'pending' | 'invalid'
  ready: boolean
  reason: string | null
  protocol: string
  metric_schema_version: number
  scope?: string | null
  case_count?: number
  result_rows?: number
  methods: Record<string, MethodMetricSummary>
  significance?: Record<string, SignificanceResult>
  acceptance?: { passed?: boolean; checks?: Record<string, boolean> }
  behavioral_gate?: {
    passed?: boolean
    forward_notifications?: number
    receiver_signature_count?: number
    context_adaptive_action?: boolean
  }
  provenance: EvidenceProvenance | null
}
