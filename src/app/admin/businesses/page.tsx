import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";

export default async function AdminBusinessesPage() {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/app");
  const service = createServiceSupabase();
  const { data: businesses } = await service
    .from("businesses")
    .select("id,name,slug,catalog_source,auto_reply")
    .order("name");

  async function createBusiness(formData: FormData) {
    "use server";
    const session = await getSessionUser();
    if (!session || !(await isPlatformAdmin(session.id))) return;
    const name = String(formData.get("name") ?? "").trim();
    const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
    const catalog_source = String(formData.get("catalog_source") ?? "internal");
    const auto_reply = formData.get("auto_reply") === "on";
    if (!name || !slug) return;
    const db = createServiceSupabase();
    await db.from("businesses").insert({ name, slug, catalog_source, auto_reply });
    revalidatePath("/admin/businesses");
  }

  async function addMember(formData: FormData) {
    "use server";
    const session = await getSessionUser();
    if (!session || !(await isPlatformAdmin(session.id))) return;
    const businessId = String(formData.get("business_id") ?? "");
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const db = createServiceSupabase();
    const { data: profile } = await db.from("profiles").select("id").eq("email", email).maybeSingle();
    if (!profile) return;
    await db.from("business_users").upsert({
      business_id: businessId,
      user_id: profile.id,
      role: "staff",
    });
    revalidatePath("/admin/businesses");
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-8">
      <a href="/app" className="text-sm text-zinc-600 underline">Kthehu</a>
      <h1 className="text-2xl font-semibold">Bizneset</h1>
      <form action={createBusiness} className="grid gap-3 rounded-lg border bg-white p-4">
        <input name="name" placeholder="Emri" className="rounded border px-3 py-2" required />
        <input name="slug" placeholder="slug" className="rounded border px-3 py-2" required />
        <select name="catalog_source" className="rounded border px-3 py-2">
          <option value="internal">Katalog manual</option>
          <option value="zana">Zana Store API</option>
          <option value="external">API e jashtme</option>
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="auto_reply" /> Auto-reply
        </label>
        <button className="rounded bg-zinc-900 px-4 py-2 text-white" type="submit">
          Krijo biznes
        </button>
      </form>
      <ul className="space-y-4">
        {(businesses ?? []).map((b) => (
          <li key={b.id} className="rounded-lg border bg-white p-4">
            <p className="font-medium">{b.name} ({b.slug})</p>
            <p className="text-sm text-zinc-600">
              {b.catalog_source} · auto-reply {b.auto_reply ? "on" : "off"}
            </p>
            <form action={addMember} className="mt-3 flex gap-2">
              <input type="hidden" name="business_id" value={b.id} />
              <input name="email" type="email" placeholder="email stafi" className="flex-1 rounded border px-3 py-2" />
              <button className="rounded border px-3 py-2" type="submit">Shto</button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
