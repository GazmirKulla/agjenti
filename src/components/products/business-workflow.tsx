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
      <div className="rounded-xl border border-[var(--line)] p-4 grid gap-2">
        <span className="muted-copy">Workflow kryesor i biznesit</span>
        <strong>{workflow?.name ?? "Workflow kryesor ende i papublikuar"}</strong>
        {workflow && <span className="muted-copy">{workflow.status}</span>}
        <p className="muted-copy">Mesazhi hyn këtu. Agjenti kërkon në katalog dhe zgjedh hapin sipas kërkesës: informacion, porosi ose ndihmë.</p>
        <Link href={`/b/${slug}/workflows`}>Hap workflow-in kryesor →</Link>
      </div>
    )}
    {product && (product.visual_workflow || product.visual_draft) && <details>
      <summary>Proces i posaçëm i këtij produkti</summary>
      <p className="muted-copy">Ky përjashtim ekzistues përdoret kur klienti nis procesin për këtë produkt. Pyetjet për informacion kalojnë te workflow-i kryesor.</p>
      <EntityFlowLink slug={slug} kind="product" id={product.id} binding={product.visual_workflow} draft={product.visual_draft} />
    </details>}
  </div>;
}
