import { ActionForm } from "@/components/dashboard/action-form";
import { DeleteBusinessPanel } from "@/components/dashboard/delete-business";
import { RecordBrowser } from "@/components/dashboard/record-browser";
import { PageHeading, StatusBadge } from "@/components/dashboard/ui";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";

export default async function AdminBusinessesPage() {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/auth/continue");
  const service = createServiceSupabase();
  const { data: businesses, error: loadError } = await service
    .from("businesses")
    .select("id,name,slug,catalog_source,auto_reply")
    .order("name");
  if (loadError) throw new Error("Nuk u ngarkuan të dhënat.");

  async function createBusiness(formData: FormData) {
    "use server";
    const session = await getSessionUser();
    if (!session || !(await isPlatformAdmin(session.id)))
      return { error: "Kërkohet qasja e administratorit." };
    const name = String(formData.get("name") ?? "").trim();
    const slug = String(formData.get("slug") ?? "")
      .trim()
      .toLowerCase();
    const catalog_source = String(formData.get("catalog_source") ?? "internal");
    const auto_reply = formData.get("auto_reply") === "on";
    if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
      return {
        error:
          "Vendos emrin dhe një slug me shkronja të vogla, numra ose viza.",
      };
    if (!["internal", "external"].includes(catalog_source))
      return { error: "Burimi i katalogut nuk është i vlefshëm." };
    const db = createServiceSupabase();
    const { error } = await db
      .from("businesses")
      .insert({ name, slug, catalog_source, auto_reply });
    if (error)
      return {
        error:
          error.code === "23505"
            ? "Ky slug përdoret nga një biznes tjetër."
            : "Biznesi nuk u krijua. Provo përsëri.",
      };
    revalidatePath("/admin/businesses");
  }

  async function addMember(formData: FormData) {
    "use server";
    const session = await getSessionUser();
    if (!session || !(await isPlatformAdmin(session.id)))
      return { error: "Kërkohet qasja e administratorit." };
    const businessId = String(formData.get("business_id") ?? "");
    const email = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    const db = createServiceSupabase();
    const { data: profile } = await db
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (!profile)
      return {
        error:
          "Nuk u gjet një përdorues me këtë email. Përdoruesi duhet të regjistrohet fillimisht.",
      };
    const { error } = await db.from("business_users").upsert(
      {
        business_id: businessId,
        user_id: profile.id,
        role: "staff",
      },
      { onConflict: "business_id,user_id", ignoreDuplicates: true },
    );
    if (error)
      return {
        error: "Anëtari nuk u shtua. Kontrollo biznesin dhe provo përsëri.",
      };
    revalidatePath("/admin/businesses");
  }

  return (
    <>
      <PageHeading
        eyebrow="PLATFORMA"
        title="Bizneset"
        description="Menaxho bizneset dhe qasjen e ekipit në Agjenti.app."
      />
      <RecordBrowser
        listTitle="Të gjitha bizneset"
        placeholder="Kërko biznes ose slug…"
        columns={["Biznesi", "Katalogu", "Përgjigje automatike"]}
        createLabel="Shto biznes"
        createForm={
          <ActionForm action={createBusiness} className="grid gap-4">
            <label className="form-label">
              Emri i biznesit
              <input name="name" className="field" required />
            </label>
            <label className="form-label">
              Adresa e biznesit (slug)
              <input
                name="slug"
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                className="field"
                required
              />
            </label>
            <label className="form-label">
              Burimi i katalogut
              <select name="catalog_source" className="field">
                <option value="internal">Katalog i brendshëm</option>
                <option value="external">Katalog i jashtëm (API)</option>
              </select>
            </label>
            <label className="toggle-label">
              <span>Përgjigje automatike</span>
              <input
                type="checkbox"
                name="auto_reply"
                className="switch-input"
              />
            </label>
            <button className="btn btn-primary" type="submit">
              Krijo biznes
            </button>
          </ActionForm>
        }
        records={(businesses ?? []).map((b) => ({
          id: b.id,
          title: b.name,
          subtitle: `/${b.slug}`,
          cells: [
            b.catalog_source === "external"
              ? "I jashtëm (API)"
              : "I brendshëm",
            <StatusBadge
              key="ai"
              status={b.auto_reply ? "connected" : "paused"}
            />,
          ],
          detail: (
            <>
              <div className="detail-header">
                <div>
                  <h2>{b.name}</h2>
                  <p>/{b.slug}</p>
                </div>
                <span className="profile-avatar">
                  {b.name.slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div className="detail-block">
                <h3>Informacion bazë</h3>
                <dl className="detail-fields">
                  <div>
                    <dt>Katalogu</dt>
                    <dd>
                      {b.catalog_source === "external"
                        ? "I jashtëm (API)"
                        : "I brendshëm"}
                    </dd>
                  </div>
                  <div>
                    <dt>Përgjigje automatike</dt>
                    <dd>{b.auto_reply ? "Aktive" : "Joaktive"}</dd>
                  </div>
                </dl>
                <Link className="soft-link" href={`/b/${b.slug}`}>
                  Hap panelin e biznesit →
                </Link>
              </div>
              <div className="detail-block">
                <h3>Shto anëtar në ekip</h3>
                <p className="muted-copy">
                  Përdoruesi duhet të ketë një llogari të regjistruar.
                </p>
                <ActionForm action={addMember} className="grid gap-3 mt-4">
                  <input type="hidden" name="business_id" value={b.id} />
                  <label className="form-label">
                    Email
                    <input
                      name="email"
                      type="email"
                      className="field"
                      required
                    />
                  </label>
                  <button className="btn btn-ghost" type="submit">
                    Shto në ekip
                  </button>
                </ActionForm>
              </div>
              <DeleteBusinessPanel
                businessId={b.id}
                slug={b.slug}
                businessName={b.name}
                redirectTo="/admin/businesses"
                embedded
              />
            </>
          ),
        }))}
      />
    </>
  );
}
