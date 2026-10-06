import { ActionForm } from "@/components/dashboard/action-form";
import { BusinessNameField } from "@/components/dashboard/business-name-field";
import { DeleteBusinessPanel } from "@/components/dashboard/delete-business";
import { RecordBrowser } from "@/components/dashboard/record-browser";
import { PageHeading, StatusBadge } from "@/components/dashboard/ui";
import {
  allocateUniqueBusinessSlug,
  slugifyBusinessName,
} from "@/lib/businesses/slug";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";

export default async function AdminBusinessesPage() {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/auth/continue");
  const service = createServiceSupabase();
  const [{ data: businesses, error: loadError }, { data: integrations }] =
    await Promise.all([
      service
        .from("businesses")
        .select("id,name,slug,auto_reply")
        .order("name"),
      service
        .from("integrations")
        .select("business_id,catalog_url")
        .eq("kind", "http"),
    ]);
  if (loadError) throw new Error("Nuk u ngarkuan të dhënat.");
  const linkedIds = new Set(
    (integrations ?? [])
      .filter((i) => Boolean(i.catalog_url?.trim()))
      .map((i) => i.business_id),
  );

  async function createBusiness(formData: FormData) {
    "use server";
    const session = await getSessionUser();
    if (!session || !(await isPlatformAdmin(session.id)))
      return { error: "Kërkohet qasja e administratorit." };
    const name = String(formData.get("name") ?? "").trim();
    const auto_reply = formData.get("auto_reply") === "on";
    const base = slugifyBusinessName(name);
    if (!name || !base)
      return {
        error: "Vendos një emër biznesi me të paktën një shkronjë ose numër.",
      };
    const db = createServiceSupabase();
    const slug = await allocateUniqueBusinessSlug(db, base);
    const { error } = await db
      .from("businesses")
      .insert({ name, slug, catalog_source: "internal", auto_reply });
    if (error)
      return {
        error:
          error.code === "23505"
            ? "Ky slug sapo u zë. Provo përsëri."
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
        createAsModal
        createForm={
          <ActionForm action={createBusiness} className="grid gap-4">
            <BusinessNameField />
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
            linkedIds.has(b.id) ? "Lidhur me API" : "Produkte në panel",
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
                      {linkedIds.has(b.id)
                        ? "Lidhur me API të jashtme"
                        : "Produkte në panel"}
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
