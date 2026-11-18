import Link from "next/link";
import type { BusinessWorkflow } from "@/lib/workflows/visual/business-workflow";
import { EntityFlowLink } from "@/components/workflows/entity-flow-link";
import type { AutomaticCapability } from "@/lib/orchestration/automatic-process";

const automaticLabels: Record<AutomaticCapability, string> = {
  orders: "Merr porosi", orderStatus: "Tregon statusin e porosisë", bookings: "Rezervon", handoff: "Ia kalon bisedën stafit",
};

export function ProductBusinessWorkflow({ slug, workflow, product }: {
  slug: string;
  workflow?: BusinessWorkflow | null;
  product?: { id: string; visual_workflow?: { flowId: string; name: string } | null; visual_draft?: { id: string; name: string; status: string } | null };
}) {
  return <div className="grid gap-3">
    {workflow?.automatic ? (
      // Built by the server from the modules: the owner sees what the agent does, not a workflow to publish.
      <div className="rounded-xl border border-[var(--line)] p-4 grid gap-2">
        <span className="muted-copy">Çfarë bën Agjenti vetë</span>
        <ul className="product-checklist">
          {workflow.automatic.readiness.map(r => (
            <li key={r.capability} className={r.ready ? "is-complete" : ""}>
              <span aria-hidden>{r.ready ? "✓" : "○"}</span>
              <span>{automaticLabels[r.capability]}<small className="muted-copy"> · {r.reason}</small></span>
            </li>
          ))}
        </ul>
        <p className="muted-copy">Agjenti i ndërton vetë hapat nga produktet dhe cilësimet e tua. Konfirmon me klientin para çdo porosie ose rezervimi.</p>
      </div>
    ) : (
      // The owner's own process decides; it stays reachable under the agent's advanced settings.
      <div className="rounded-xl border border-[var(--line)] p-4 grid gap-2">
        <span className="muted-copy">Çfarë bën Agjenti</span>
        {workflow ? <>
          <strong>Ndjek procesin tënd të personalizuar</strong>
          <span className="muted-copy">{workflow.name} · {workflow.status}</span>
          <p className="muted-copy">Agjenti kërkon në katalog dhe vazhdon sipas kërkesës së klientit: informacion, porosi ose ndihmë.</p>
          <Link href={`/b/${slug}/workflows`}>Shiko procesin →</Link>
        </> : <p className="muted-copy">Nuk u verifikua çfarë mund të bëjë Agjenti tani. Provo përsëri pas pak.</p>}
      </div>
    )}
    {product && (product.visual_workflow || product.visual_draft) && <details>
      <summary>Proces i posaçëm i këtij produkti</summary>
      <p className="muted-copy">Kur klienti porosit këtë produkt, Agjenti ndjek këtë proces. Pyetjeve për informacion u përgjigjet si zakonisht.</p>
      <EntityFlowLink slug={slug} kind="product" id={product.id} binding={product.visual_workflow} draft={product.visual_draft} />
    </details>}
  </div>;
}
