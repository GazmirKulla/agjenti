import { ModuleDescription } from "@/components/dashboard/module-description";
import "@/components/dashboard/actions.css";
import Link from "next/link";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { loadAllowedModules } from "@/lib/dashboard/modules/entitlements";
import { moduleRegistry, toggleableModules } from "@/lib/dashboard/modules/registry";
import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { actionCatalog } from "@/lib/actions/catalog";
import {
  saveBusinessActionSettings,
  changeInvitation,
} from "@/lib/actions/manage";
import { decryptSecret } from "@/lib/crypto/tokens";
import { ActionForm } from "@/components/dashboard/action-form";
import { ProvisionBusinessForm } from "@/components/dashboard/provision-business-form";
import { PageHeading } from "@/components/dashboard/ui";
export default async function BusinessActionsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params,
    user = await getSessionUser(),
    access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access) redirect("/login");
  const db = createServiceSupabase(),
    id = access.business.id;
  const [settings, member, permissions] = await Promise.all([
    db.from("business_action_settings").select("*").eq("business_id", id),
    db
      .from("business_users")
      .select("role")
      .eq("business_id", id)
      .eq("user_id", user.id)
      .maybeSingle(),
    Promise.all(
      Object.keys(actionCatalog).map(async (key) => {
        const r = await db.rpc("can_execute_business_action", {
          p_business: id,
          p_user: user.id,
          p_action: key,
          p_automated: false,
        });
        return { key, ...r };
      }),
    ),
  ]);
  if (settings.error || member.error || permissions.some((p) => p.error))
    return (
      <p role="alert">
        Nuk u ngarkuan veprimet. Kontrollo migrimin dhe lidhjen me databazën.
      </p>
    );
  const configure = access.admin || member.data?.role === "owner",
    canProvision =
      permissions.find((p) => p.key === "business.provision")?.data === true;
  const profile = await loadDashboardProfile(id);
  const allowedModules = new Set(await loadAllowedModules(id));
  const invitations = canProvision
    ? await db
        .from("business_invitations")
        .select("id,email,details,status,expires_at,token_ciphertext")
        .eq("source_business_id", id)
        .order("created_at", { ascending: false })
        .limit(50)
    : null;
  return (
    <>
      <PageHeading
        eyebrow={access.business.name}
        title="Aftësitë e biznesit"
        description="Administratori përcakton modulet dhe aftësitë e lejuara për këtë biznes. Përdori nga hapësira jote."
      />
      <div className="grid gap-6">
        {Object.entries(actionCatalog).filter(([key]) => key === "business.provision").map(([key, a]) => {
          const s = settings.data?.find((x) => x.action_key === key),
            allowed = permissions.find((p) => p.key === key)?.data === true;
          return (
            <section className="detail-block" key={key}>
              <h2>{a.name}</h2>
              <p>{a.description}</p>
              <p>
                {allowed
                  ? "I disponueshëm për ty"
                  : "Kjo aftësi nuk është e lejuar për ty në këtë biznes."}
              </p>
              {!allowed && access.admin && <Link className="soft-link" href={`/admin/businesses/${id}/permissions`}>Konfiguro lejen për këtë biznes →</Link>}
              {configure && allowed && (
                <ActionForm
                  action={saveBusinessActionSettings.bind(null, slug)}
                  className="grid gap-3"
                >
                  <input type="hidden" name="action_key" value={key} />
                  {a.automated && (
                    <>
                      <label>
                        <input
                          type="checkbox"
                          name="automation_allowed"
                          defaultChecked={s?.automation_allowed ?? false}
                        />{" "}
                        Lejo workflow-t e publikuara
                      </label>
                      <label>
                        Afati i ftesës në ditë
                        <input
                          className="field"
                          type="number"
                          name="invitation_days"
                          min="1"
                          max="30"
                          defaultValue={s?.invitation_days ?? 7}
                        />
                      </label>
                    </>
                  )}
                  <button className="btn btn-ghost">Ruaj konfigurimin</button>
                </ActionForm>
              )}
            </section>
          );
        })}
        {canProvision && (
          <section className="detail-block">
            <h2>Krijo biznes dhe ftesë pronësie</h2>
            <p>Biznesi i ri bëhet i marrësit kur ai pranon ftesën me emailin e përcaktuar. Krijimi nuk të jep akses në biznesin e tij.</p>
            <ProvisionBusinessForm slug={slug} />
          </section>
        )}
        {canProvision && (
          <section className="detail-block">
            <h2>Ftesat e fundit</h2>
            {invitations?.error ? (
              <p role="alert">Ftesat nuk u ngarkuan.</p>
            ) : !invitations?.data?.length ? (
              <p>Ende nuk ka ftesa.</p>
            ) : (
              invitations.data.map((i) => {
                const active =
                  i.status === "pending" && new Date(i.expires_at) > new Date();
                let url = "";
                try {
                  if (active)
                    url = `${process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? ""}/join?request=${decryptSecret(i.token_ciphertext)}`;
                } catch {}
                return (
                  <article className="detail-block" key={i.id}>
                    <h3>{i.details?.name ?? "Biznes"}</h3>
                    <p>
                      {i.email} ·{" "}
                      {i.status === "accepted"
                        ? "Pranuar"
                        : i.status === "revoked"
                          ? "Anuluar"
                          : active
                            ? "Në pritje"
                            : "Skaduar"}
                    </p>
                    {url && (
                      <a className="soft-link" href={url}>
                        {url}
                      </a>
                    )}
                    {i.status !== "accepted" && (
                      <ActionForm action={changeInvitation.bind(null, slug)}>
                        <input
                          type="hidden"
                          name="invitation_id"
                          value={i.id}
                        />
                        <button
                          className="btn btn-ghost"
                          name="operation"
                          value="rotate"
                        >
                          Rigjenero linkun
                        </button>
                        <button
                          className="btn btn-ghost"
                          name="operation"
                          value="revoke"
                        >
                          Anulo ftesën
                        </button>
                      </ActionForm>
                    )}
                  </article>
                );
              })
            )}
          </section>
        )}
        <section className="detail-block">
          <h2>Modulet e hapësirës</h2>
          <p>Leja e administratorit dhe aktivizimi në hapësirë janë dy gjendje të veçanta.</p>
          <div className="capability-grid">
            {toggleableModules.map(moduleId => {
              const mod = moduleRegistry[moduleId];
              const available = allowedModules.has(moduleId);
              const active = available && profile.enabledModules.includes(moduleId);
              return <article className="capability-card" key={moduleId}>
                <h3>{mod.label}</h3><ModuleDescription moduleId={moduleId} />
                <p className="muted-copy">{!available ? "Nuk lejohet nga administratori" : active ? "I lejuar · aktiv në hapësirë" : "I lejuar · joaktiv në hapësirë"}</p>
                {active && <Link className="soft-link" href={`/b/${slug}/${mod.path}`}>Hap {mod.label} →</Link>}
              </article>;
            })}
          </div>
          <Link className="btn btn-ghost" href={`/b/${slug}/settings/modules`}>Menaxho aktivizimin e moduleve</Link>
        </section>
      </div>
    </>
  );
}
