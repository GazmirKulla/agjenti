import type { AutomaticCapability, AutomaticReadiness } from "@/lib/orchestration/automatic-process";

const labels: Record<AutomaticCapability, string> = {
  orders: "Merr porosi", orderStatus: "Tregon statusin e porosisë", bookings: "Rezervon", handoff: "Ia kalon bisedën stafit",
};

/** For a business without its own workflow: what the agent does by itself, and what is missing for the rest. */
export function AutomaticAgentPanel({ readiness }: { readiness: AutomaticReadiness[] }) {
  return (
    <section className="panel section-pad automatic-agent" aria-labelledby="automatic-agent-title">
      <h2 id="automatic-agent-title">Agjenti punon vetë</h2>
      <p className="muted-copy">Nuk ke nevojë të ndërtosh workflow. Agjenti i ndërton vetë hapat nga produktet, shërbimet dhe cilësimet e tua, dhe konfirmon me klientin para çdo porosie ose rezervimi.</p>
      <ul className="automatic-agent-list">
        {readiness.map(r => (
          <li key={r.capability} className={r.ready ? "is-ready" : ""}>
            <span aria-hidden>{r.ready ? "✓" : "○"}</span>
            <span><strong>{labels[r.capability]}</strong><small>{r.reason}</small></span>
          </li>
        ))}
      </ul>
    </section>
  );
}
