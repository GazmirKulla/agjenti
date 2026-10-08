import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { DiscoverySetup } from "@/components/setup/discovery";
import { SetupJourney } from "@/components/setup/journey";
import { getSetupStatus } from "@/lib/setup/status";
import { createServiceSupabase } from "@/lib/supabase/service";
export const metadata = { title: "Përgatit biznesin | Agjenti.app" };
export default async function SetupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!access) redirect("/auth/continue");
  const [status, discovery, onboarding] = await Promise.all([
    getSetupStatus(access.business.id),
    createServiceSupabase().from("business_discovery").select("confirmed_at").eq("business_id", access.business.id).maybeSingle(),
    createServiceSupabase().from("business_onboarding").select("answers").eq("business_id", access.business.id).maybeSingle(),
  ]);
  const sources = Boolean(discovery.data) || onboarding.data?.answers?.onboardingMode === "sources";
  return <><DiscoverySetup slug={slug} businessId={access.business.id} />{sources ? <details className="context-launch-options"><summary>Përgjigjet automatike · Opsionale</summary><SetupJourney status={status} slug={slug} /></details> : <SetupJourney status={status} slug={slug} />}</>;
}
