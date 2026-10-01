import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

export default async function AgentsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/app");
  const db = createServiceSupabase();
  const { data: agents } = await db
    .from("ai_agents")
    .select("id,name,instructions,is_active")
    .eq("business_id", access.business.id);

  async function save(formData: FormData) {
    "use server";
    const session = await getSessionUser();
    if (!session) return;
    const acc = await requireBusinessAccess(session.id, slug);
    if (!acc) return;
    const supabase = createServiceSupabase();
    const id = String(formData.get("id") ?? "");
    const name = String(formData.get("name") ?? "Agjent");
    const instructions = String(formData.get("instructions") ?? "");
    const isActive = formData.get("is_active") === "on";
    if (isActive) {
      await supabase.from("ai_agents").update({ is_active: false }).eq("business_id", acc.business.id);
    }
    if (id) {
      await supabase.from("ai_agents").update({ name, instructions, is_active: isActive }).eq("id", id);
    } else {
      await supabase.from("ai_agents").insert({
        business_id: acc.business.id,
        name,
        instructions,
        is_active: isActive,
      });
    }
    revalidatePath(`/b/${slug}/agents`);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Agjentët</h1>
      <p className="text-sm text-zinc-600">Një agjent aktiv për biznes. Modeli vendoset nga platforma.</p>
      {(agents ?? []).map((a) => (
        <form key={a.id} action={save} className="grid gap-2 rounded-lg border bg-white p-4">
          <input type="hidden" name="id" value={a.id} />
          <input name="name" defaultValue={a.name} className="rounded border px-3 py-2" />
          <textarea name="instructions" defaultValue={a.instructions} rows={6} className="rounded border px-3 py-2" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_active" defaultChecked={a.is_active} /> Aktiv
          </label>
          <button className="w-fit rounded bg-zinc-900 px-4 py-2 text-white" type="submit">
            Ruaj
          </button>
        </form>
      ))}
      <form action={save} className="grid gap-2 rounded-lg border bg-white p-4">
        <p className="font-medium">Agjent i ri</p>
        <input name="name" placeholder="Emri" className="rounded border px-3 py-2" defaultValue="Agjent shitjesh" />
        <textarea
          name="instructions"
          rows={6}
          className="rounded border px-3 py-2"
          defaultValue="You are a customer support agent. Write in the customer's language. Do not invent prices. Ask only for the current workflow step."
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="is_active" defaultChecked /> Aktiv
        </label>
        <button className="w-fit rounded bg-zinc-900 px-4 py-2 text-white" type="submit">
          Krijo
        </button>
      </form>
    </div>
  );
}
