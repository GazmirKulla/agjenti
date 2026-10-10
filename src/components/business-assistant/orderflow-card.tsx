"use client";
import Link from "next/link";
import type { OrderFlowContext } from "@/lib/business-assistant/orderflow-service";
import "./workflow-card.css";
export function OrderFlowCard({
  data,
  slug,
  onRequest,
}: {
  data: OrderFlowContext;
  slug: string;
  onRequest: (text: string) => void;
}) {
  return (
    <section className="assistant-flow-card" aria-label="Rrjedhat e porosive">
      <header>
        <small>RRJEDHAT E PRODUKTEVE</small>
        <h3>Hapat e porosive</h3>
        <p>Secili produkt mund të ketë rrjedhën e vet.</p>
      </header>
      {data.partial && (
        <p>
          Shfaqet një pjesë e listës. Specifiko produktin ose rrjedhën që
          kërkon.
        </p>
      )}
      {!data.flows.length && (
        <p>
          Ende nuk ka rrjedha porosish. Përshkruaj cilat të dhëna duhet të
          kërkojë Agjenti për produktin.
        </p>
      )}
      {data.flows.map((flow) => (
        <details key={flow.id} open={data.flows.length === 1}>
          <summary>{flow.name}</summary>
          <ol className="assistant-flow-steps">
            {flow.steps.map((step) => (
              <li key={step.key}>
                <strong>{step.label}</strong>
              </li>
            ))}
          </ol>
          <p>
            Produktet:{" "}
            {data.products
              .filter((p) => p.workflow_id === flow.id)
              .map((p) => p.name)
              .join(", ") ||
              (data.partial
                ? "Nuk gjenden në këtë pjesë të listës"
                : "Ende pa produkt të lidhur")}
          </p>
          <button
            type="button"
            className="assistant-secondary"
            onClick={() =>
              onRequest(
                `Dua të ndryshoj hapat e rrjedhës së porosive “${flow.name}”.`,
              )
            }
          >
            Përshtat hapat
          </button>
        </details>
      ))}
      <footer>
        <Link href={`/b/${slug}/workflows`}>Hap workflow-t →</Link>
        <button
          type="button"
          className="assistant-secondary"
          onClick={() =>
            onRequest(
              "Dua të krijoj një rrjedhë të re porosie për një produkt.",
            )
          }
        >
          Krijo rrjedhë
        </button>
      </footer>
    </section>
  );
}
