import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadNavigationProfile } from "@/lib/dashboard/profile/service";
import { loadAllowedModules } from "@/lib/dashboard/modules/entitlements";
import { loadItemSetup } from "@/lib/items/business";
import { createServiceSupabase } from "@/lib/supabase/service";
import { ModulesSettingsPanel } from "@/components/dashboard/modules-settings";

export default async function ModulesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const [profile, allowed, items, provision] = await Promise.all([
    loadNavigationProfile(access.business.id),
    loadAllowedModules(access.business.id),
    loadItemSetup(access.business.id),
    // Creating businesses for clients is a partner capability: shown only to those who have it.
    createServiceSupabase().rpc("can_execute_business_action", { p_business: access.business.id, p_user: user.id, p_action: "business.provision", p_automated: false }),
  ]);
  return <ModulesSettingsPanel slug={access.business.slug} profile={profile} allowed={allowed}
    itemsLabel={items.names.plural} provisioning={provision.data === true} />;
}
