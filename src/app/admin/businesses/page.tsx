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
  const [
    { data: businesses, error: loadError },
    { data: integrations },
    { data: memberships },
  ] = await Promise.all([
    service
      .from("businesses")
      .select("id,name,slug,auto_reply,allow_multiple_agents")
      .order("name"),
    service
      .from("integrations")
      .select("business_id,catalog_url")
      .eq("kind", "http"),
    service
      .from("business_users")
      .select("business_id,user_id,role,created_at")
      .order("created_at"),
  ]);
  const businessesFallback =
    loadError && ["42P01", "PGRST205", "42703"].includes(loadError.code)
      ? await service
          .from("businesses")
          .select("id,name,slug,auto_reply")
          .order("name")
      : null;
  if (loadError && !businessesFallback?.data)
    throw new Error("Nuk u ngarkuan të dhënat.");
  if (businessesFallback?.error) throw new Error("Nuk u ngarkuan të dhënat.");
  const businessRows = (
    businessesFallback?.data ??
    businesses ??
    []
  ).map((b) => ({
    ...b,
    allow_multiple_agents: Boolean(
      "allow_multiple_agents" in b && b.allow_multiple_agents,
    ),
  }));
  const linkedIds = new Set(
    (integrations ?? [])
      .filter((i) => Boolean(i.catalog_url?.trim()))
      .map((i) => i.business_id),
  );
  const memberUserIds = [
    ...new Set((memberships ?? []).map((m) => m.user_id).filter(Boolean)),
  ];
  const { data: memberProfiles } =
    memberUserIds.length > 0
      ? await service
          .from("profiles")
          .select("id,email,display_name")
          .in("id", memberUserIds)
      : { data: [] as { id: string; email: string | null; display_name: string | null }[] };
  const profileById = new Map(
    (memberProfiles ?? []).map((p) => [p.id, p] as const),
  );
  const membersByBusiness = new Map<
    string,
    {
      user_id: string;
      role: string;
      email: string;
      display_name: string;
    }[]
  >();
  for (const row of memberships ?? []) {
    const profile = profileById.get(row.user_id);
    const list = membersByBusiness.get(row.business_id) ?? [];
    list.push({
      user_id: row.user_id,
      role: row.role,
      email: profile?.email?.trim() || "—",
      display_name:
        profile?.display_name?.trim() ||
        profile?.email?.split("@")[0] ||
        "Përdorues",
    });
    membersByBusiness.set(row.business_id, list);
  }

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
    const role =
      String(formData.get("role") ?? "staff") === "owner" ? "owner" : "staff";
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
        role,
      },
      { onConflict: "business_id,user_id" },
    );
    if (error)
      return {
        error: "Anëtari nuk u shtua. Kontrollo biznesin dhe provo përsëri.",
      };
    revalidatePath("/admin/businesses");
    return { success: "Anëtari u shtua në ekip." };
  }

  async function removeMember(formData: FormData) {
    "use server";
    const session = await getSessionUser();
    if (!session || !(await isPlatformAdmin(session.id)))
      return { error: "Kërkohet qasja e administratorit." };
    const businessId = String(formData.get("business_id") ?? "");
    const userId = String(formData.get("user_id") ?? "");
    if (!businessId || !userId) return { error: "Anëtari nuk u gjet." };
    const { error } = await createServiceSupabase()
      .from("business_users")
      .delete()
      .eq("business_id", businessId)
      .eq("user_id", userId);
    if (error)
      return {
        error: "Anëtari nuk u hoq. Provo përsëri.",
      };
    revalidatePath("/admin/businesses");
    return { success: "Aksesi u hoq." };
  }

  async function saveBusinessSettings(formData: FormData) {
    "use server";
    const session = await getSessionUser();
    if (!session || !(await isPlatformAdmin(session.id)))
      return { error: "Kërkohet qasja e administratorit." };
    const businessId = String(formData.get("business_id") ?? "");
    if (!businessId) return { error: "Biznesi nuk u gjet." };
    const { error } = await createServiceSupabase()
      .from("businesses")
      .update({
        allow_multiple_agents: formData.get("allow_multiple_agents") === "on",
      })
      .eq("id", businessId);
    if (error)
      return {
        error: ["42P01", "PGRST205", "42703"].includes(error.code)
          ? "Duhet aplikuar migrimi allow_multiple_agents në databazë."
          : "Cilësimet nuk u ruajtën. Provo përsëri.",
      };
    revalidatePath("/admin/businesses");
    revalidatePath("/b", "layout");
    return { success: "Cilësimet e klientit u ruajtën." };
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
        columns={["Biznesi", "Katalogu", "Përgjigje automatike", "Dy agjentë", "Onboarding"]}
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
        records={businessRows.map((b) => {
          const team = membersByBusiness.get(b.id) ?? [];
          return {
            id: b.id,
            title: b.name,
            subtitle: `/${b.slug}`,
            cells: [
              linkedIds.has(b.id) ? "Lidhur me API" : "Produkte në panel",
              <StatusBadge
                key="ai"
                status={b.auto_reply ? "connected" : "paused"}
              />,
              b.allow_multiple_agents ? "Po" : "Jo",
              <Link
                key="onboarding"
                className="btn btn-ghost"
                href={`/b/${b.slug}/setup`}
                aria-label={`Onboarding për ${b.name}`}
              >
                Onboarding
              </Link>,
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
                    <div>
                      <dt>Dy agjentë</dt>
                      <dd>{b.allow_multiple_agents ? "Të lejuar" : "Jo"}</dd>
                    </div>
                  </dl>
                  <Link className="soft-link" href={`/b/${b.slug}`}>
                    Hap panelin e biznesit →
                  </Link>
                </div>
                <div className="detail-block">
                  <h3>Cilësimet e klientit</h3>
                  <p className="muted-copy">
                    Kontrollo sa konfigurime agjenti mund të mbajë ky biznes. Si
                    parazgjedhje lejohet vetëm një; me këtë opsion deri në dy.
                  </p>
                  <ActionForm
                    action={saveBusinessSettings}
                    className="grid gap-3 mt-4"
                  >
                    <input type="hidden" name="business_id" value={b.id} />
                    <label className="toggle-label">
                      <span>
                        Lejo dy agjentë
                        <small>
                          Vetëm një mbetet aktiv për klientët; i dyti është
                          konfigurim alternativ.
                        </small>
                      </span>
                      <input
                        type="checkbox"
                        name="allow_multiple_agents"
                        className="switch-input"
                        defaultChecked={b.allow_multiple_agents}
                      />
                    </label>
                    <button className="btn btn-ghost" type="submit">
                      Ruaj cilësimet
                    </button>
                  </ActionForm>
                </div>
                <div className="detail-block">
                  <h3>Ekipi me akses</h3>
                  <p className="muted-copy">
                    Përdoruesit që mund të hapin panelin e këtij biznesi.
                  </p>
                  {team.length === 0 ? (
                    <p className="muted-copy mt-4">
                      Asnjë anëtar nuk ka akses ende.
                    </p>
                  ) : (
                    <ul className="team-member-list">
                      {team.map((member) => (
                        <li key={member.user_id} className="team-member-row">
                          <div className="team-member-info">
                            <strong>{member.display_name}</strong>
                            <span>{member.email}</span>
                          </div>
                          <span className="team-member-role">
                            {member.role === "owner" ? "Pronar" : "Staf"}
                          </span>
                          <ActionForm
                            action={removeMember}
                            successMessage="Aksesi u hoq."
                            className="team-member-remove"
                          >
                            <input
                              type="hidden"
                              name="business_id"
                              value={b.id}
                            />
                            <input
                              type="hidden"
                              name="user_id"
                              value={member.user_id}
                            />
                            <button
                              className="btn btn-ghost"
                              type="submit"
                              aria-label={`Hiq aksesin për ${member.email}`}
                            >
                              Hiq
                            </button>
                          </ActionForm>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="team-member-add">
                    <h4>Shto anëtar</h4>
                    <p className="muted-copy">
                      Përdoruesi duhet të ketë një llogari të regjistruar.
                    </p>
                    <ActionForm
                      action={addMember}
                      successMessage="Anëtari u shtua në ekip."
                      className="grid gap-3 mt-4"
                    >
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
                      <label className="form-label">
                        Roli
                        <select
                          name="role"
                          className="field"
                          defaultValue="staff"
                        >
                          <option value="staff">Staf</option>
                          <option value="owner">Pronar</option>
                        </select>
                      </label>
                      <button className="btn btn-ghost" type="submit">
                        Shto në ekip
                      </button>
                    </ActionForm>
                  </div>
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
          };
        })}
      />
    </>
  );
}
