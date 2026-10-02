import { ActionForm } from "@/components/dashboard/action-form";
import { PageHeading } from "@/components/dashboard/ui";
import { Icon } from "@/components/dashboard/icon";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/app");

  async function save(formData: FormData) {
    "use server";
    const session = await getSessionUser();
    if (!session) return { error: "Sesioni ka skaduar. Hyr përsëri." };
    const acc = await requireBusinessAccess(session.id, slug);
    if (!acc) return { error: "Nuk ke qasje në këtë biznes." };
    const catalogSource = String(
      formData.get("catalog_source") ?? acc.business.catalog_source,
    );
    if (!["internal", "zana", "external"].includes(catalogSource))
      return { error: "Burimi i katalogut nuk është i vlefshëm." };
    const catalogUrl = String(formData.get("catalog_url") ?? "").trim();
    const ordersUrl = String(formData.get("orders_url") ?? "").trim();
    for (const value of [catalogUrl, ordersUrl]) {
      if (!value) continue;
      try {
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol))
          return { error: "URL-të duhet të fillojnë me https:// ose http://." };
      } catch {
        return { error: "Vendos URL të vlefshme për katalogun dhe porositë." };
      }
    }
    const db = createServiceSupabase();
    await db
      .from("integrations")
      .upsert(
        {
          business_id: acc.business.id,
          kind: catalogSource === "zana" ? "zana" : "http",
          catalog_url: catalogUrl || null,
          orders_url: ordersUrl || null,
        },
        { onConflict: "business_id,kind" },
      )
      .throwOnError();
    await db
      .from("businesses")
      .update({
        auto_reply: formData.get("auto_reply") === "on",
        catalog_source: catalogSource,
      })
      .eq("id", acc.business.id)
      .throwOnError();
    revalidatePath(`/b/${slug}`, "layout");
    return { success: "Cilësimet u ruajtën." };
  }

  const { data: integration, error: integrationError } =
    await createServiceSupabase()
      .from("integrations")
      .select("catalog_url,orders_url")
      .eq("business_id", access.business.id)
      .eq("kind", access.business.catalog_source === "zana" ? "zana" : "http")
      .maybeSingle();
  if (integrationError) throw new Error("Nuk u ngarkua integrimi i biznesit.");

  return (
    <>
      <PageHeading
        eyebrow="Cilësimet"
        title={access.business.name}
        description="Menaxho përgjigjet automatike dhe lidhjet me katalogun e biznesit."
      />
      <div className="settings-tabs">
        <span>
          <Icon name="businesses" size={18} />
          Informacioni i biznesit
        </span>
      </div>
      <div className="configuration-layout">
        <ActionForm action={save} className="panel section-pad grid gap-5">
          <div className="section-title">
            <h2>Të dhënat e biznesit</h2>
            <button className="btn btn-primary" type="submit">
              Ruaj ndryshimet
            </button>
          </div>
          <div className="detail-block">
            <dl className="detail-fields">
              <div>
                <dt>Emri i biznesit</dt>
                <dd>{access.business.name}</dd>
              </div>
              <div>
                <dt>Adresa në platformë</dt>
                <dd>/{slug}</dd>
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
          <label className="form-label">
            Burimi i katalogut
            <select
              name="catalog_source"
              defaultValue={access.business.catalog_source}
              className="field"
            >
              <option value="internal">Katalog manual</option>
              <option value="zana">Zana Store</option>
              <option value="external">API e jashtme</option>
            </select>
          </label>
          <label className="form-label">
            URL e katalogut
            <input
              type="url"
              name="catalog_url"
              defaultValue={integration?.catalog_url ?? ""}
              placeholder="https://…"
              className="field"
            />
          </label>
          <label className="form-label">
            URL e porosive
            <input
              type="url"
              name="orders_url"
              defaultValue={integration?.orders_url ?? ""}
              placeholder="https://…"
              className="field"
            />
          </label>
        </ActionForm>
        <aside className="panel section-pad">
          <span className="icon-tile">
            <Icon name="workflows" size={25} />
          </span>
          <h2 className="text-lg mt-5">Katalogu dhe porositë</h2>
          <p className="muted-copy">
            Me katalogun manual, produktet shtohen brenda panelit. Integrimet
            Zana dhe API e jashtme ruajnë lidhjen me sistemin ekzistues të
            shitjeve.
          </p>
          <p className="muted-copy">
            Workflow-t mbeten të lidhura me llojin e produktit.
          </p>
        </aside>
      </div>
    </>
  );
}
