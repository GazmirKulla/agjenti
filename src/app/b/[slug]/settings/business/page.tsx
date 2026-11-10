import { setupGateMessage } from "@/lib/setup/model";
import { loadSetupStatus } from "@/lib/setup/status";
import { setBusinessAutoReply } from "@/lib/agents/auto-reply";
import { ActionForm } from "@/components/dashboard/action-form";
import { saveItemSetup } from "@/lib/items/actions";
import { loadItemSetup } from "@/lib/items/business";
import { ITEM_KINDS } from "@/lib/items/kinds";
import { BusinessProfile } from "@/components/dashboard/business-profile";
import { PageHeading } from "@/components/dashboard/ui";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

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
    try { await setBusinessAutoReply(acc.business.id, formData.get("auto_reply") === "on", acc.business.auto_reply); }
    catch (error) { return { error: (error as Error).message }; }
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
  const items = await loadItemSetup(access.business.id);
  const autoReplyBlocked = access.business.auto_reply
    ? null
    : setupGateMessage(await loadSetupStatus(access.business.id));
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
        description="Profili i biznesit dhe përgjigjet automatike për klientët."
      />
      <div className="grid gap-6">
            <BusinessProfile
              answers={profileAnswers}
              slug={slug}
              failed={!!onboardingError || !!prepared?.error}
            />
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
            <ActionForm action={saveItemSetup.bind(null, slug)} className="panel section-pad grid gap-5">
              <div className="section-title">
                <h2>Çfarë shet biznesi</h2>
                <button className="btn btn-primary" type="submit">Ruaj</button>
              </div>
              <p className="muted-copy">
                Lloji vendos fushat e secilit artikull (p.sh. m² dhe dhoma për pronat) dhe emrin në menu.
                Artikujt ekzistues e ruajnë llojin e tyre.
              </p>
              <div className="item-kind-choices">
                {Object.values(ITEM_KINDS).map((kind) => (
                  <label key={kind.id} className="item-kind-choice">
                    <input type="radio" name="item_kind" value={kind.id} defaultChecked={items.kind.id === kind.id} />
                    <span><strong>{kind.plural}</strong><small>{kind.description}</small></span>
                  </label>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="form-label">
                  Emri në menu (opsional)
                  <input className="field" name="item_plural" maxLength={30} defaultValue={items.custom.plural ?? ""} placeholder={items.kind.plural} />
                </label>
                <label className="form-label">
                  Një artikull quhet (opsional)
                  <input className="field" name="item_singular" maxLength={30} defaultValue={items.custom.singular ?? ""} placeholder={items.kind.singular} />
                </label>
              </div>
            </ActionForm>
      </div>
    </>
  );
}
