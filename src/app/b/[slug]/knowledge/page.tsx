import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

export default async function KnowledgePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/app");
  const db = createServiceSupabase();
  const { data: entries } = await db
    .from("knowledge_entries")
    .select("id,title,body,intent_key")
    .eq("business_id", access.business.id)
    .order("sort_order");

  async function importZanaFaq() {
    "use server";
    const session = await getSessionUser();
    if (!session) return;
    const acc = await requireBusinessAccess(session.id, slug);
    if (!acc) return;
    const base = process.env.ZANA_API_BASE_URL?.replace(/\/$/, "");
    const secret = process.env.ZANA_AGJENTI_SECRET?.trim();
    if (!base || !secret) return;
    const res = await fetch(`${base}/api/integrations/agjenti/knowledge`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!res.ok) return;
    const json = (await res.json()) as {
      entries: Array<{ question: string; answer: string; intent_key: string | null; sort_order: number }>;
    };
    const db = createServiceSupabase();
    for (const entry of json.entries ?? []) {
      await db.from("knowledge_entries").insert({
        business_id: acc.business.id,
        title: entry.question,
        body: entry.answer,
        intent_key: entry.intent_key,
        sort_order: entry.sort_order ?? 0,
      });
    }
    revalidatePath(`/b/${slug}/knowledge`);
  }

  async function add(formData: FormData) {
    "use server";
    const session = await getSessionUser();
    if (!session) return;
    const acc = await requireBusinessAccess(session.id, slug);
    if (!acc) return;
    await createServiceSupabase().from("knowledge_entries").insert({
      business_id: acc.business.id,
      title: String(formData.get("title") ?? "").trim(),
      body: String(formData.get("body") ?? "").trim(),
      intent_key: String(formData.get("intent_key") ?? "").trim() || null,
    });
    revalidatePath(`/b/${slug}/knowledge`);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Njohuri</h1>
      {access.business.catalog_source === "zana" ? (
        <form action={importZanaFaq}>
          <button className="btn btn-ghost" type="submit">
            Kopjo FAQ-të nga Zana një herë
          </button>
        </form>
      ) : null}
      <form action={add} className="grid max-w-lg gap-2 panel p-4">
        <input name="title" placeholder="Titulli" className="field" required />
        <input name="intent_key" placeholder="intent_key" className="field" />
        <textarea name="body" placeholder="Teksti" className="field" rows={4} required />
        <button className="btn btn-primary" type="submit">
          Shto
        </button>
      </form>
      <ul className="space-y-2">
        {(entries ?? []).map((e) => (
          <li key={e.id} className="panel p-3">
            <p className="font-medium">{e.title}</p>
            <p className="text-sm text-ink-muted">{e.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
