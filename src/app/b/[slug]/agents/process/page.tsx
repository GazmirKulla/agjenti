import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { PageHeading, StatusBadge } from "@/components/dashboard/ui";
import { BusinessProcessView } from "@/components/workflows/business-process";
import { OrderIntakeSetting } from "@/components/dashboard/order-intake-setting";
import { AgentBehaviorSetting, AgentBookingSwitch, CustomerQuestionsEditor, HandoffMessageForm } from "@/components/agents/capability-settings";
import { loadAgentBehavior } from "@/lib/agents/behavior";
import { parseCommunicationPolicy } from "@/lib/agents/communication-policy";
import { automaticStatus, defaultHandoffMessage, type AutomaticCapability, type AutomaticReadiness } from "@/lib/orchestration/automatic-process";
import { loadBusinessProcess } from "@/lib/discovery/load-process";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { askFields, readBusinessFields } from "@/lib/items/fields";
import { createServiceSupabase } from "@/lib/supabase/service";

export const metadata = { title: "Çfarë bën Agjenti | Agjenti.app" };

const titles: Record<AutomaticCapability, string> = {
  orders: "Merr porosi", orderStatus: "Tregon statusin e porosisë", bookings: "Rezervon", handoff: "Ia kalon bisedën stafit",
};

/**
 * Everything the customer agent does, one card per capability: whether it is ready (or why not) and the
 * business settings that shape it, changed here. A setting that belongs to one product stays on the
 * product and is listed here. The owner's own published process, when there is one, decides the steps.
 */
export default async function AgentProcessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const businessId = access.business.id, base = `/b/${encodeURIComponent(slug)}`;
  const db = createServiceSupabase();
  const [own, automatic, operating, profile, policy, business, informationOnly, calendar, agent] = await Promise.all([
    db.from("visual_workflows").select("published_version_id,enabled").eq("business_id", businessId).maybeSingle(),
    automaticStatus(businessId),
    loadBusinessProcess(businessId),
    loadDashboardProfile(businessId),
    db.from("business_automation_policies").select("local_orders").eq("business_id", businessId).maybeSingle(),
    db.from("businesses").select("product_fields").eq("id", businessId).maybeSingle(),
    db.from("products").select("id,name", { count: "exact" }).eq("business_id", businessId).eq("is_active", true).is("archived_at", null)
      .eq("agent_orders", false).order("name").limit(8),
    db.from("business_calendar_settings").select("agent_booking_enabled").eq("business_id", businessId).maybeSingle(),
    db.from("ai_agents").select("communication,updated_at").eq("business_id", businessId).eq("is_active", true).maybeSingle(),
  ]);
  const behavior = await loadAgentBehavior(businessId);
  let handoffMessage = "";
  try { handoffMessage = agent.data?.communication ? parseCommunicationPolicy(agent.data.communication).handoffMessage ?? "" : ""; } catch { handoffMessage = ""; }
  const ownProcess = !own.error && own.data?.published_version_id ? { enabled: own.data.enabled === true } : null;
  const enabled = new Set(profile.enabledModules);
  const readiness = new Map<AutomaticCapability, AutomaticReadiness>((automatic?.readiness ?? []).map(r => [r.capability, r]));
  const questions = business.error ? null : askFields(readBusinessFields(business.data?.product_fields));
  const localOrders = policy.error ? null : policy.data?.local_orders === true;

  // One card per capability: its state, then what shapes it.
  const card = (capability: AutomaticCapability, body: React.ReactNode) => {
    const state = readiness.get(capability);
    return <section key={capability} className="panel section-pad grid gap-3" aria-labelledby={`capability-${capability}`}>
      <div className="section-title">
        <h2 id={`capability-${capability}`}>{titles[capability]}</h2>
        {state && <StatusBadge status={state.ready ? "connected" : "draft"} label={state.ready ? "Gati" : "Jo ende"} />}
      </div>
      {state && <p className="muted-copy">{state.reason}</p>}
      {body}
    </section>;
  };

  return <>
    <PageHeading eyebrow={access.business.name} title="Çfarë bën Agjenti"
      description="Çdo gjë që bën Agjenti me klientët, në një vend: çfarë është gati dhe si e ndryshon. Nuk ke nevojë të vizatosh procese." />
    {ownProcess ? (
      <section className="panel section-pad grid gap-2">
        <h2>Agjenti ndjek procesin tënd të personalizuar</h2>
        <p className="muted-copy">{ownProcess.enabled ? "Procesi që ke publikuar vendos hapat e Agjentit për gjithë biznesin. Cilësimet më poshtë vlejnë edhe për të." : "Ke publikuar një proces të personalizuar, por është i fikur: Agjenti vetëm informon derisa ta ndezësh ose ta heqësh."}</p>
        {enabled.has("workflows") && <Link className="inline-link" href={`${base}/workflows`}>Hap procesin e personalizuar →</Link>}
      </section>
    ) : !automatic && <section className="panel section-pad"><p className="muted-copy">Nuk u verifikua çfarë mund të bëjë Agjenti tani. Rifresko faqen pas pak.</p></section>}

    {enabled.has("orders") && card("orders", <>
      <OrderIntakeSetting slug={slug} enabled={localOrders} embedded />
      <div className="grid gap-2">
        <h3 className="font-semibold">Çfarë e pyet klientin kur porosit</h3>
        <small className="muted-copy">Agjenti i bën pasi klienti zgjedh produktin, para përmbledhjes, dhe përgjigja shkon me porosinë. Te çdo produkt, te “Si e porosit klienti”, zgjedh cilat bën.</small>
        {questions === null ? <p className="muted-copy">Pyetjet nuk u lexuan. Rifresko faqen.</p> : <CustomerQuestionsEditor slug={slug} questions={questions} />}
      </div>
      <div className="grid gap-2">
        <h3 className="font-semibold">Produkte vetëm për informim</h3>
        {informationOnly.error ? <p className="muted-copy">Nuk u lexuan. Rifresko faqen.</p>
          : informationOnly.data?.length ? <>
            <p className="muted-copy">Agjenti i prezanton, por nuk merr porosi për {informationOnly.count === 1 ? "këtë produkt" : `këto ${informationOnly.count} produkte`}:</p>
            <ul className="grid gap-1">{informationOnly.data.map(p => <li key={p.id}><Link className="inline-link" href={`${base}/products/${p.id}?edit=1#product-process`}>{p.name}</Link></li>)}</ul>
            {(informationOnly.count ?? 0) > informationOnly.data.length && <small className="muted-copy">Dhe {(informationOnly.count ?? 0) - informationOnly.data.length} të tjera.</small>}
          </>
          : <p className="muted-copy">Asnjë: Agjenti merr porosi për çdo produkt aktiv me çmim. E ndryshon te forma e produktit, te “Si e porosit klienti”.</p>}
      </div>
    </>)}

    {enabled.has("orders") && card("orderStatus", null)}

    {(enabled.has("bookings") || enabled.has("services")) && card("bookings",
      <>
        {calendar.error ? <p className="muted-copy">Kalendari nuk u lexua. Rifresko faqen.</p>
          : calendar.data ? <AgentBookingSwitch slug={slug} enabled={calendar.data.agent_booking_enabled === true} />
          : <p className="muted-copy">Cakto fillimisht orarin te <Link className="inline-link" href={`${base}/calendar`}>Kalendari</Link>.</p>}
        <small className="muted-copy">Orari: <Link className="inline-link" href={`${base}/calendar`}>Kalendari →</Link> · Shërbimet që pranojnë rezervime: <Link className="inline-link" href={`${base}/services`}>Shërbimet →</Link></small>
      </>)}

    {card("handoff", <>
      {agent.error || !agent.data ? <p className="muted-copy">Agjenti aktiv nuk u gjet. Krijoje ose aktivizoje te <Link className="inline-link" href={`${base}/agents`}>Udhëzimet</Link>.</p>
        : <HandoffMessageForm slug={slug} message={handoffMessage} updatedAt={agent.data.updated_at} fallback={defaultHandoffMessage} />}
      <AgentBehaviorSetting slug={slug} kind="escalation" value={behavior.escalation} />
    </>)}

    <section className="panel section-pad grid gap-3" aria-labelledby="capability-voice">
      <div className="section-title"><h2 id="capability-voice">Lexon mesazhet zanore dhe videot</h2></div>
      <AgentBehaviorSetting slug={slug} kind="voice" value={behavior.voice} />
    </section>

    <details className="vf-product-details"><summary>Udhëzimet nga onboarding-u</summary>
      <BusinessProcessView slug={slug} initialProcess={operating.process} initialRevision={operating.revision} />
    </details>
    {enabled.has("workflows") && !ownProcess && <p className="muted-copy">Për raste të veçanta (kushte, veprime të jashtme) ekziston edhe <Link className="inline-link" href={`${base}/workflows`}>procesi i personalizuar (i avancuar)</Link>.</p>}
  </>;
}
