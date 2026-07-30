export function LoadingSkeleton() {
  return (
    <section className="loading-skeleton" aria-label="Loading simulation" aria-busy="true">
      <div className="skeleton-line skeleton-line--short" />
      <div className="skeleton-map" />
      <span className="sr-only">Loading simulation data</span>
    </section>
  )
}
