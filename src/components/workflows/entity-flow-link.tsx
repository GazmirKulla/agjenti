import Link from "next/link";
import { Icon } from "@/components/dashboard/icon";
import "./entity-flow-link.css";

export function entityWorkflowHref(slug: string, kind: "product" | "service", id: string, flowId?: string) {
  const query = new URLSearchParams({ [kind]: id, ...(flowId ? { flow: flowId } : {}) });
  return `/b/${slug}/workflows?${query}`;
}

export function EntityFlowLink({ slug, kind, id, binding, enabled = true }: {
  slug: string; kind: "product" | "service"; id: string;
  binding?: { flowId: string; name: string } | null; enabled?: boolean;
}) {
  return <div className="entity-flow-link">
    <span className="entity-flow-link-icon"><Icon name="workflows" size={17} /></span>
    <div><small>{kind === "product" ? "Rrjedha e produktit" : "Rrjedha e shërbimit"}</small><strong>{binding?.name ?? "Pa lidhje të publikuar"}</strong>
      {binding && !enabled && <small>Rrjedha është e çaktivizuar</small>}
      <Link href={entityWorkflowHref(slug, kind, id, binding?.flowId)}>{binding ? "Ndrysho rrjedhën" : "Lidh me një rrjedhë"} →</Link>
    </div>
  </div>;
}
