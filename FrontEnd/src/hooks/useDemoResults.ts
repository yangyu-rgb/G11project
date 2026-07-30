import { useCallback, useEffect, useState } from 'react'

import type { DemoResultsSummary } from '../types/demoResults'

export function useDemoResults() {
  const [results, setResults] = useState<DemoResultsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch('/api/v1/demo/results-summary')
      .then((response) => response.ok ? response.json() as Promise<DemoResultsSummary> : Promise.reject())
      .then(setResults)
      .catch(() => setError('无法读取留出集结果'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(refresh, [refresh])
  return { results, loading, error, refresh }
}
