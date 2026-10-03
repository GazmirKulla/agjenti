export function DashboardLoading() {
  return (
    <section
      role="status"
      aria-live="polite"
      aria-label="Duke ngarkuar faqen"
      className="grid gap-6"
    >
      <p className="muted-copy">Duke ngarkuar…</p>
      <div className="stats-grid" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="panel section-pad min-h-28 bg-slate-50" />
        ))}
      </div>
      <div className="panel section-pad min-h-64" aria-hidden="true" />
    </section>
  );
}
