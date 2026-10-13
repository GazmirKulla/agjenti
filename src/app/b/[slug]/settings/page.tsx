import { loadSetupStatus } from "@/lib/setup/status";
import { setupGateMessage } from "@/lib/setup/model";
import { ActionForm } from "@/components/dashboard/action-form";
import { DeleteBusinessPanel } from "@/components/dashboard/delete-business";
import { ModulesSettingsPanel } from "@/components/dashboard/modules-settings";
import { BusinessProfile } from "@/components/dashboard/business-profile";
import { SettingsTabs } from "@/components/dashboard/settings-tabs";
import { PageHeading } from "@/components/dashboard/ui";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug: requestedSlug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, requestedSlug);
  if (!access) redirect("/auth/continue");
  const slug = access.business.slug;

  async function saveBusiness(formData: FormData) {
    "use server";
    const session = await getSessionUser();
    if (!session) return { error: "Sesioni ka skaduar. Hyr përsëri." };
    const acc = await requireBusinessAccess(session.id, slug);
    if (!acc) return { error: "Nuk ke qasje në këtë biznes." };
    if (formData.get("auto_reply") === "on" && !acc.business.auto_reply) {
      const blocked = setupGateMessage(await loadSetupStatus(acc.business.id));
      if (blocked) return { error: blocked };
    }
    const db = createServiceSupabase();
    if (formData.get("auto_reply") === "on" && !acc.business.auto_reply) {
      const { error } = await db.rpc("launch_business", {
        p_business_id: acc.business.id,
        p_automatic: true,
      });
      if (error)
        return {
          error: "Konfigurimi ndryshoi. Kontrollo hapat nga Dashboard.",
        };
    }
    await db
      .from("businesses")
      .update({ auto_reply: formData.get("auto_reply") === "on" })
      .eq("id", acc.business.id)
      .throwOnError();
    revalidatePath(`/b/${slug}`, "layout");
    return { success: "Cilësimet e biznesit u ruajtën." };
  }

  const { data: integration, error: integrationError } =
    await createServiceSupabase()
      .from("integrations")
      .select("catalog_url")
      .eq("business_id", access.business.id)
      .eq("kind", "http")
      .maybeSingle();
  if (integrationError) throw new Error("Nuk u ngarkua integrimi i biznesit.");

  const linked = Boolean(integration?.catalog_url?.trim());
  const autoReplyBlocked = access.business.auto_reply
    ? null
    : setupGateMessage(await loadSetupStatus(access.business.id));
  const dashboardProfile = await loadDashboardProfile(access.business.id);
  const { data: onboarding, error: onboardingError } = await createServiceSupabase()
    .from("business_onboarding")
    .select("answers")
    .eq("business_id", access.business.id)
    .maybeSingle();

  const prepared = !onboarding?.answers ? await createServiceSupabase()
    .from("business_invitations").select("details").eq("target_business_id",access.business.id).eq("status","accepted").maybeSingle() : null;
  const profileAnswers = onboarding?.answers ?? (prepared?.data ? { name:prepared.data.details?.name, details:{businessDescription:prepared.data.details?.description} } : undefined);

  return (
    <>
      <PageHeading
        eyebrow="Cilësimet"
        title={access.business.name}
        description="Shiko profilin e biznesit dhe menaxho cilësimet dhe modulet."
      />
      <SettingsTabs
        panels={{
          profile: (
            <BusinessProfile
              answers={profileAnswers}
              slug={slug}
              failed={!!onboardingError || !!prepared?.error}
            />
          ),
          data: (
            <ActionForm
              action={saveBusiness}
              className="panel section-pad grid gap-5"
            >
              <div className="section-title">
                <h2>Të dhënat e biznesit</h2>
                <button className="btn btn-primary" type="submit">
                  Ruaj
                </button>
              </div>
              <div className="detail-block settings-detail-block">
                <dl className="detail-fields">
                  <div>
                    <dt>Emri i biznesit</dt>
                    <dd>{access.business.name}</dd>
                  </div>
                  <div>
                    <dt>Adresa në platformë</dt>
                    <dd>/{slug}</dd>
                  </div>
                  <div>
                    <dt>Katalogu</dt>
                    <dd>
                      {linked
                        ? "Lidhur me API të jashtme"
                        : "Produkte të krijuara në panel"}
                    </dd>
                  </div>
                </dl>
              </div>
              <label className="toggle-label">
                <span>
                  Përgjigje automatike
                  <small>
                    Agjenti u përgjigjet mesazheve të reja në bisedat aktive.
                  </small>
                </span>
                <input
                  type="checkbox"
                  name="auto_reply"
                  className="switch-input"
                  defaultChecked={access.business.auto_reply}
                />
              </label>
              {autoReplyBlocked && (
                <p className="muted-copy" role="status">
                  {autoReplyBlocked}{" "}
                  <a className="soft-link" href={`/b/${slug}`}>
                    Hap Dashboard →
                  </a>
                </p>
              )}
            </ActionForm>
          ),
          modules: (
            <ModulesSettingsPanel
              slug={slug}
              businessId={access.business.id}
              profile={dashboardProfile}
            />
          ),
        }}
        aside={
          <>
            <DeleteBusinessPanel
              businessId={access.business.id}
              slug={slug}
              businessName={access.business.name}
              redirectTo="/auth/continue"
            />
          </>
        }
      />
    </>
  );
}
