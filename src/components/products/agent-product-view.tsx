import Link from "next/link";
import type { GroundedProduct } from "@/lib/agents/business-grounding";

/**
 * One product as the agent reads it: the line a customer sees for it and every fact the agent can use.
 * Empty facts are shown as missing, because the agent cannot match or tell what it does not have.
 */
export function AgentProductView({ slug, view }: { slug: string; view: { product: GroundedProduct; line: string } | null }) {
  if (!view) return (
    <section className="panel section-pad grid gap-3" aria-labelledby="agent-view-title">
      <h2 id="agent-view-title">Si e sheh Agjenti një produkt</h2>
      <p className="muted-copy">Kur të kesh një produkt aktiv, këtu shfaqet pikërisht çfarë di Agjenti për të.</p>
    </section>
  );
  const { product } = view;
  const rows: [string, string | undefined, string][] = [
    ["Përshkrimi", product.description ?? undefined, "Pa përshkrim, Agjenti e gjen vetëm kur klienti thotë emrin."],
    ["Të dhënat", product.details, "Pa të dhëna nga fushat e tua."],
    ["Variantet", product.variants ?? product.choices, "Pa variante ose zgjedhje."],
    ["Gjendja", product.stock, "Stoku nuk ndiqet: Agjenti nuk flet për sasi."],
  ];
  return (
    <section className="panel section-pad grid gap-3 agent-product-view" aria-labelledby="agent-view-title">
      <div className="section-title">
        <h2 id="agent-view-title">Si e sheh Agjenti një produkt</h2>
        <Link className="btn btn-ghost" href={`/b/${slug}/products/${product.id}`}>Hap produktin</Link>
      </div>
      <p className="muted-copy">Shembull me produktin e fundit që ke ndryshuar. Kështu e merr Agjenti në çdo përgjigje.</p>
      <p className="agent-product-line"><span>Klienti e sheh:</span> <strong>{view.line}</strong></p>
      <dl className="product-detail-rows">
        {rows.map(([label, value, missing]) => (
          <div key={label}><dt>{label}</dt><dd>{value?.trim() ? value : <span className="muted-copy">{missing}</span>}</dd></div>
        ))}
      </dl>
    </section>
  );
}
