"use client";
export function DashboardError({ reset }: { reset: () => void }) {
  return (
    <section className="panel empty-state" role="alert">
      <h2>Nuk u ngarkuan të dhënat</h2>
      <p>
        Kontrollo lidhjen dhe provo përsëri. Të dhënat e biznesit nuk janë
        ndryshuar.
      </p>
      <button type="button" onClick={reset} className="btn btn-primary mt-5">
        Provo përsëri
      </button>
    </section>
  );
}
