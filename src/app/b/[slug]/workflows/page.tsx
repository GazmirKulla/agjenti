import { ActionForm } from "@/components/dashboard/action-form";
import { PageHeading, EmptyState } from "@/components/dashboard/ui";
import { Icon } from "@/components/dashboard/icon";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  APPAREL_STEPS,
  PUZZLE_STEPS,
  SIMPLE_STEPS,
} from "@/lib/workflows/engine";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

export default async function WorkflowsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const db = createServiceSupabase();
  const { data: workflows, error: loadError } = await db
    .from("workflows")
    .select("id,name,workflow_steps(key,position,kind,config)")
    .eq("business_id", access.business.id);
  if (loadError) throw new Error("Nuk u ngarkuan të dhënat.");

  async function seedZana() {
    "use server";
    const session = await getSessionUser();
    if (!session) return { error: "Sesioni ka skaduar. Hyr përsëri." };
    const acc = await requireBusinessAccess(session.id, slug);
    if (!acc) return { error: "Nuk ke qasje në këtë biznes." };
    const businessId = acc.business.id;
    const supabase = createServiceSupabase();
    async function seed(
      name: string,
      steps: typeof PUZZLE_STEPS,
      typeName: string,
      externalKey: string,
    ) {
      const { data: wf } = await supabase
        .from("workflows")
        .insert({ business_id: businessId, name })
        .select("id")
        .single()
        .throwOnError();
      if (!wf) throw new Error("Workflow nuk u krijua.");
      await supabase
        .from("workflow_steps")
        .insert(
          steps.map((s, i) => ({
            workflow_id: wf.id,
            key: s.key,
            position: i,
            kind: s.kind,
            required: true,
            config: { label: s.label },
          })),
        )
        .throwOnError();
      await supabase
        .from("product_types")
        .insert({
          business_id: businessId,
          name: typeName,
          workflow_id: wf.id,
          external_key: externalKey,
        })
        .throwOnError();
    }
    await seed("Puzzle", PUZZLE_STEPS, "Puzzle", "puzzle");
    await seed("Bluzë", APPAREL_STEPS, "Bluzë", "tshirt");
    revalidatePath(`/b/${slug}`, "layout");
  }

  async function addSimple(formData: FormData) {
    "use server";
    const session = await getSessionUser();
    if (!session) return { error: "Sesioni ka skaduar. Hyr përsëri." };
    const acc = await requireBusinessAccess(session.id, slug);
    if (!acc) return { error: "Nuk ke qasje në këtë biznes." };
    const name = String(formData.get("name") ?? "").trim() || "E thjeshtë";
    const supabase = createServiceSupabase();
    const { data: wf } = await supabase
      .from("workflows")
      .insert({ business_id: acc.business.id, name })
      .select("id")
      .single()
      .throwOnError();
    if (!wf) throw new Error("Workflow nuk u krijua.");
    await supabase
      .from("workflow_steps")
      .insert(
        SIMPLE_STEPS.map((s, i) => ({
          workflow_id: wf.id,
          key: s.key,
          position: i,
          kind: s.kind,
          required: true,
          config: { label: s.label },
        })),
      )
      .throwOnError();
    await supabase
      .from("product_types")
      .insert({
        business_id: acc.business.id,
        name,
        workflow_id: wf.id,
      })
      .throwOnError();
    revalidatePath(`/b/${slug}`, "layout");
  }

  return (
    <>
      <PageHeading
        title="Workflow AI"
        description="Përcakto rrugën që ndjek porosia sipas llojit të produktit."
      >
        <Link href={`/b/${slug}/product-types`} className="btn btn-ghost">
          Menaxho llojet →
        </Link>
      </PageHeading>
      <div className="configuration-layout">
        <div className="space-y-5">
          {(workflows ?? []).map((w) => (
            <section key={w.id} className="panel section-pad">
              <div className="section-title">
                <h2>{w.name}</h2>
                <span className="icon-tile">
                  <Icon name="workflows" />
                </span>
              </div>
              <div className="workflow-steps">
                {(
                  (w.workflow_steps as {
                    key: string;
                    position: number;
                    kind: string;
                    config: { label?: string };
                  }[]) ?? []
                )
                  .sort((a, b) => a.position - b.position)
                  .map((step, i) => (
                    <div className="workflow-step" key={step.key}>
                      <span>{i + 1}</span>
                      <div>
                        <h3>{step.config?.label || step.key}</h3>
                        <p>
                          {(
                            {
                              choice: "Zgjedhje",
                              text: "Tekst",
                              photo: "Foto",
                              customer: "Të dhënat e klientit",
                              confirm: "Konfirmim",
                            } as Record<string, string>
                          )[step.kind] || step.kind}
                        </p>
                      </div>
                      <Icon name="arrow" size={18} />
                    </div>
                  ))}
              </div>
            </section>
          ))}
          {!workflows?.length && (
            <section className="panel">
              <EmptyState
                title="Ende nuk ka workflow"
                description="Krijo një workflow dhe lidhe me llojin e produktit."
              />
            </section>
          )}
        </div>
        <aside className="space-y-5">
          <ActionForm
            action={addSimple}
            className="panel section-pad grid gap-4"
          >
            <h2 className="text-lg">Shto workflow të thjeshtë</h2>
            <p className="muted-copy">
              Krijon një lloj produkti dhe hapat bazë për mbledhjen e porosisë.
            </p>
            <label className="form-label">
              Emri i llojit të produktit
              <input
                name="name"
                placeholder="P.sh. Aksesorë"
                className="field"
                required
              />
            </label>
            <button className="btn btn-primary" type="submit">
              Krijo workflow
            </button>
          </ActionForm>
          {access.business.catalog_source === "zana" && (
            <ActionForm action={seedZana} className="panel section-pad">
              <h2 className="text-lg">Workflow-t e Zana</h2>
              <p className="muted-copy mb-5">
                Hapat për puzzle dhe bluza të personalizuara.
              </p>
              <button className="btn btn-ghost" type="submit">
                Importo workflow-t
              </button>
            </ActionForm>
          )}
        </aside>
      </div>
    </>
  );
}
