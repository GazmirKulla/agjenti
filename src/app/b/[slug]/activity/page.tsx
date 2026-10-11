import Link from "next/link";
import { PageHeading } from "@/components/dashboard/ui";
import { IntegrationActivity } from "@/components/dashboard/integration-activity";
import { requireEnabledModule } from "@/lib/dashboard/modules/permissions";
import { createServiceSupabase } from "@/lib/supabase/service";

export default async function ActivityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { access, profile } = await requireEnabledModule(slug, "inbox");
  const { data, error } = await createServiceSupabase().from("integration_logs")
    .select("id,target,status,error,created_at").eq("business_id", access.business.id)
    .order("created_at", { ascending: false }).limit(8);
  if (error) throw new Error("Nuk u ngarkua aktiviteti i integrimit.");
  return <>
    <PageHeading title="Aktiviteti" description="Aktiviteti i integrimit dhe hyrjet te historiku ekzistues i biznesit." />
    <section className="panel section-pad">
      <h2>Aktiviteti i integrimit të biznesit</h2>
      <p className="muted-copy">Deri në 8 regjistrimet më të fundit, të njëjtat që shfaqen edhe te Bisedat.</p>
      <div className="space-y-3 mt-4"><IntegrationActivity logs={data ?? []} /></div>
    </section>
    <nav className="flex flex-wrap gap-3 mt-5" aria-label="Historiku në hapësirat ekzistuese">
      <Link className="btn btn-ghost" href={`/b/${slug}/inbox`}>Bisedat →</Link>
      {profile.enabledModules.includes("agents") && <Link className="btn btn-ghost" href={`/b/${slug}/agents/memory`}>Memoria e agjentit →</Link>}
      {profile.enabledModules.includes("workflows") && <Link className="btn btn-ghost" href={`/b/${slug}/workflows`}>Workflow dhe versionet →</Link>}
    </nav>
  </>;
}
