import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/app");

  async function save(formData: FormData) {
    "use server";
    const session = await getSessionUser();
    if (!session) return;
    const acc = await requireBusinessAccess(session.id, slug);
    if (!acc) return;
    await createServiceSupabase()
      .from("businesses")
      .update({
        auto_reply: formData.get("auto_reply") === "on",
          catalog_source: String(formData.get("catalog_source") ?? acc.business.catalog_source),
        })
        .eq("id", acc.business.id);
    const catalog_url = String(formData.get("catalog_url") ?? "").trim();
    const orders_url = String(formData.get("orders_url") ?? "").trim();
    const kind = String(formData.get("catalog_source") ?? acc.business.catalog_source) === "zana" ? "zana" : "http";
    if (catalog_url || orders_url) {
      await createServiceSupabase().from("integrations").upsert(
        {
          business_id: acc.business.id,
          kind,
          catalog_url: catalog_url || null,
          orders_url: orders_url || null,
        },
        { onConflict: "business_id,kind" },
      );
    }
    revalidatePath(`/b/${slug}/settings`);
  }

  const { data: integration } = await createServiceSupabase()
    .from("integrations")
    .select("catalog_url,orders_url")
    .eq("business_id", access.business.id)
    .maybeSingle();

  return (
    <form action={save} className="grid max-w-lg gap-3 rounded-lg border bg-white p-4">
      <h1 className="text-xl font-semibold">Cilësimet</h1>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="auto_reply" defaultChecked={access.business.auto_reply} />
        Auto-reply
      </label>
      <select name="catalog_source" defaultValue={access.business.catalog_source} className="rounded border px-3 py-2">
        <option value="internal">Manual</option>
        <option value="zana">Zana</option>
        <option value="external">API e jashtme</option>
      </select>
      <input
        name="catalog_url"
        defaultValue={integration?.catalog_url ?? ""}
        placeholder="URL e katalogut"
        className="rounded border px-3 py-2"
      />
      <input
        name="orders_url"
        defaultValue={integration?.orders_url ?? ""}
        placeholder="URL e porosive"
        className="rounded border px-3 py-2"
      />
      <button className="rounded bg-zinc-900 px-4 py-2 text-white" type="submit">
        Ruaj
      </button>
    </form>
  );
}
