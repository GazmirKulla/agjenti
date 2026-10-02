import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { APPAREL_STEPS, PUZZLE_STEPS, SIMPLE_STEPS } from "@/lib/workflows/engine";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

export default async function WorkflowsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/app");
  const db = createServiceSupabase();
  const { data: workflows } = await db
    .from("workflows")
    .select("id,name,workflow_steps(key,position,kind)")
    .eq("business_id", access.business.id);

  async function seedZana() {
    "use server";
    const session = await getSessionUser();
    if (!session) return;
    const acc = await requireBusinessAccess(session.id, slug);
    if (!acc) return;
    const businessId = acc.business.id;
    const supabase = createServiceSupabase();
    async function seed(name: string, steps: typeof PUZZLE_STEPS, typeName: string, externalKey: string) {
      const { data: wf } = await supabase
        .from("workflows")
        .insert({ business_id: businessId, name })
        .select("id")
        .single();
      if (!wf) return;
      await supabase.from("workflow_steps").insert(
        steps.map((s, i) => ({
          workflow_id: wf.id,
          key: s.key,
          position: i,
          kind: s.kind,
          required: true,
          config: { label: s.label },
        })),
      );
      await supabase.from("product_types").insert({
        business_id: businessId,
        name: typeName,
        workflow_id: wf.id,
        external_key: externalKey,
      });
    }
    await seed("Puzzle", PUZZLE_STEPS, "Puzzle", "puzzle");
    await seed("Bluzë", APPAREL_STEPS, "Bluzë", "tshirt");
    revalidatePath(`/b/${slug}/workflows`);
  }

  async function addSimple(formData: FormData) {
    "use server";
    const session = await getSessionUser();
    if (!session) return;
    const acc = await requireBusinessAccess(session.id, slug);
    if (!acc) return;
    const name = String(formData.get("name") ?? "").trim() || "E thjeshtë";
    const supabase = createServiceSupabase();
    const { data: wf } = await supabase
      .from("workflows")
      .insert({ business_id: acc.business.id, name })
      .select("id")
      .single();
    if (!wf) return;
    await supabase.from("workflow_steps").insert(
      SIMPLE_STEPS.map((s, i) => ({
        workflow_id: wf.id,
        key: s.key,
        position: i,
        kind: s.kind,
        required: true,
        config: { label: s.label },
      })),
    );
    await supabase.from("product_types").insert({
      business_id: acc.business.id,
      name,
      workflow_id: wf.id,
    });
    revalidatePath(`/b/${slug}/workflows`);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Workflow</h1>
      <form action={addSimple} className="flex gap-2">
        <input name="name" placeholder="Emri i llojit" className="field" />
        <button className="btn btn-primary" type="submit">
          Shto workflow të thjeshtë
        </button>
      </form>
      {access.business.catalog_source === "zana" ? (
        <form action={seedZana}>
          <button className="btn btn-ghost" type="submit">
            Importo workflow-et puzzle dhe bluzë
          </button>
        </form>
      ) : null}
      <ul className="space-y-3">
        {(workflows ?? []).map((w) => (
          <li key={w.id} className="panel p-4">
            <p className="font-medium">{w.name}</p>
            <p className="text-sm text-ink-muted">
              {(w.workflow_steps as { key: string; position: number }[] | null)
                ?.sort((a, b) => a.position - b.position)
                .map((s) => s.key)
                .join(" → ")}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
