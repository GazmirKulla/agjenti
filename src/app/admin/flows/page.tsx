import { redirect } from "next/navigation";
import { PageHeading } from "@/components/dashboard/ui";
import { ChatMessage } from "@/components/agents/chat-message";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { listFlows } from "@/lib/flows/files";
import "../prompts/prompts.css";

export const metadata = { title: "Rrjedhat | Agjenti.app" };

/** The rules of the platform's flows, read from /rrjedhat. Read-only. */
export default async function AdminFlowsPage() {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/auth/continue");
  const flows = listFlows();
  return <>
    <PageHeading eyebrow="PLATFORMA" title="Rrjedhat"
      description="Si funksionojnë rrjedhat kryesore të platformës: kushtet, hapat dhe vendimet. Teksti lexohet nga dosja rrjedhat/ e projektit; ndryshohet bashkë me kodin. Vetëm për lexim." />
    <nav className="prompt-areas" aria-label="Rrjedhat">
      {flows.map((flow) => <a key={flow.path} href={`#${flow.path}`}>{flow.meta.titulli}<span>{flow.meta.statusi}</span></a>)}
    </nav>
    {flows.map((flow) => (
      <details key={flow.path} id={flow.path} className="prompt-card" open>
        <summary>
          <span className="prompt-card-title">{flow.meta.titulli}</span>
          <span className="prompt-card-meta">
            <span>{flow.meta.statusi}</span>
            {flow.meta.perditesuar && <span>Përditësuar {flow.meta.perditesuar}</span>}
            <span>rrjedhat/{flow.path}.md</span>
          </span>
        </summary>
        <div className="flow-body"><ChatMessage text={flow.body} /></div>
      </details>
    ))}
  </>;
}
