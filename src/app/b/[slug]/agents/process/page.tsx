import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { PageHeading } from "@/components/dashboard/ui";
import { AutomaticAgentPanel } from "@/components/workflows/automatic-agent";
import { BusinessProcessView } from "@/components/workflows/business-process";
import { automaticStatus } from "@/lib/orchestration/automatic-process";
import { loadBusinessProcess } from "@/lib/discovery/load-process";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { createServiceSupabase } from "@/lib/supabase/service";

export const metadata = { title: "Çfarë bën Agjenti | Agjenti.app" };

/**
 * What the customer agent does for this business and where each part is set. Reads only: the automatic
 * process status (or that the owner's own published process decides), the onboarding instructions, and
 * links to the settings that shape the process. The workflow editor stays under its advanced entry.
 */
export default async function AgentProcessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const businessId = access.business.id, base = `/b/${encodeURIComponent(slug)}`;
  const [own, automatic, operating, profile] = await Promise.all([
    createServiceSupabase().from("visual_workflows").select("published_version_id,enabled").eq("business_id", businessId).maybeSingle(),
    automaticStatus(businessId),
    loadBusinessProcess(businessId),
    loadDashboardProfile(businessId),
  ]);
  const ownProcess = !own.error && own.data?.published_version_id ? { enabled: own.data.enabled === true } : null;
  const enabled = new Set(profile.enabledModules);
  const settings = [
    { href: `${base}/agents`, title: "Komunikimi", text: "Gjuha, toni dhe çfarë i thotë klientit kur ia kalon bisedën stafit." },
    ...(enabled.has("products") ? [
      { href: `${base}/products/structure`, title: "Struktura e produkteve", text: "Zgjedhjet e klientit (variantet), pyetjet që i bën kur porosit dhe foto nga klienti." },
      { href: `${base}/products`, title: "Produktet", text: "Te çdo produkt: nëse Agjenti merr porosi apo vetëm informon, dhe cilat pyetje bën." },
    ] : []),
    ...(enabled.has("orders") ? [{ href: `${base}/orders`, title: "Porositë", text: "Kur klienti konfirmon: Agjenti e regjistron porosinë, ose vetëm mbledh kërkesën për stafin." }] : []),
    ...(enabled.has("calendar") ? [{ href: `${base}/calendar`, title: "Kalendari", text: "Orari dhe nëse Agjenti rezervon vetë." }] : []),
    ...(enabled.has("services") ? [{ href: `${base}/services`, title: "Shërbimet", text: "Shërbimet që pranojnë rezervime." }] : []),
  ];
  return <>
    <PageHeading eyebrow={access.business.name} title="Çfarë bën Agjenti"
      description="Hapat që ndjek Agjenti me klientët dhe ku i ndryshon. Nuk ke nevojë të vizatosh procese." />
    {ownProcess ? (
      <section className="panel section-pad grid gap-2">
        <h2>Agjenti ndjek procesin tënd të personalizuar</h2>
        <p className="muted-copy">{ownProcess.enabled ? "Procesi që ke publikuar vendos hapat e Agjentit për gjithë biznesin, në vend të procesit të zakonshëm." : "Ke publikuar një proces të personalizuar, por është i fikur: Agjenti vetëm informon derisa ta ndezësh ose ta heqësh."}</p>
        {enabled.has("workflows") && <Link className="soft-link" href={`${base}/workflows`}>Hap procesin e personalizuar →</Link>}
      </section>
    ) : automatic ? <AutomaticAgentPanel readiness={automatic.readiness} />
      : <section className="panel section-pad"><p className="muted-copy">Nuk u verifikua çfarë mund të bëjë Agjenti tani. Rifresko faqen pas pak.</p></section>}
    <section className="panel section-pad grid gap-3" aria-labelledby="agent-process-settings">
      <h2 id="agent-process-settings">Ku e ndryshon</h2>
      <ul className="grid gap-2">
        {settings.map(item => <li key={item.href}><Link className="soft-link" href={item.href}><strong>{item.title} →</strong></Link><br /><small className="muted-copy">{item.text}</small></li>)}
      </ul>
    </section>
    <details className="vf-product-details"><summary>Udhëzimet nga onboarding-u</summary>
      <BusinessProcessView slug={slug} initialProcess={operating.process} initialRevision={operating.revision} />
    </details>
    {enabled.has("workflows") && !ownProcess && <p className="muted-copy">Për raste të veçanta (kushte, veprime të jashtme) ekziston edhe <Link className="soft-link" href={`${base}/workflows`}>procesi i personalizuar (i avancuar)</Link>.</p>}
  </>;
}
