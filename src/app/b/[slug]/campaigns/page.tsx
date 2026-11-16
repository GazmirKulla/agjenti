import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { loadCampaigns } from "@/lib/campaigns/service";
import { Campaigns } from "@/components/campaigns/campaigns";
export default async function CampaignsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const membership = await createServiceSupabase().from("business_users").select("role").eq("business_id", access.business.id).eq("user_id", user.id).maybeSingle();
  if (membership.error) throw new Error("Qasja nuk u verifikua.");
  let data;
  try { data = await loadCampaigns(access.business.id); }
  catch { return <section className="panel section-pad"><h1>Fushatat</h1><p>Fushatat nuk janë të disponueshme. Kontrollo migrimin e databazës ose provo përsëri më vonë.</p></section>; }
  return <Campaigns businessId={access.business.id} businessName={access.business.name} slug={slug} owner={membership.data?.role === "owner"} initialData={data} />;
}
