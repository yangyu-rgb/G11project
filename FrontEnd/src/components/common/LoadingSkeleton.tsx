export function LoadingSkeleton() {
  return (
    <section className="loading-skeleton" aria-label="正在加载仿真" aria-busy="true">
      <div className="skeleton-line skeleton-line--short" />
      <div className="skeleton-map" />
      <span className="sr-only">正在加载仿真数据</span>
    </section>
  )
}
