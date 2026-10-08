import { ActionForm } from "@/components/dashboard/action-form";
import { PageHeading, EmptyState } from "@/components/dashboard/ui";
import { Icon } from "@/components/dashboard/icon";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SIMPLE_STEPS } from "@/lib/workflows/engine";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadBusinessProcess } from "@/lib/discovery/load-process";
import { BusinessProcessView } from "@/components/workflows/business-process";

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
  const operating = await loadBusinessProcess(access.business.id);
  const [{ data: workflows, error: loadError }, { data: types }] =
    await Promise.all([
      db
        .from("workflows")
        .select("id,name,workflow_steps(key,position,kind,config)")
        .eq("business_id", access.business.id),
      db
        .from("product_types")
        .select("id,name,external_key")
        .eq("is_active", true)
        .order("sort_order"),
    ]);
  if (loadError) throw new Error("Nuk u ngarkuan të dhënat.");

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
    revalidatePath(`/b/${slug}`, "layout");
  }

  return (
    <>
      <PageHeading
        title="Workflow AI"
        description="Rrjedha që Agjenti përdor për të udhëzuar klientët, dhe workflow-t e lidhur me produktet."
      >
        <Link href={`/b/${slug}/products`} className="btn btn-ghost">
          Lidh te produktet →
        </Link>
      </PageHeading>
      <BusinessProcessView slug={slug} initialProcess={operating.process} initialRevision={operating.revision} />
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
                description="Krijo një workflow të thjeshtë, ose aplikó sugjerimin e një lloji nga Produktet."
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
              Krijon hapat bazë (konfirmim + adresë). Lidhe më pas te një
              produkt.
            </p>
            <label className="form-label">
              Emri i workflow-t
              <input
                name="name"
                placeholder="P.sh. Porosi standarde"
                className="field"
                required
              />
            </label>
            <button className="btn btn-primary" type="submit">
              Krijo workflow
            </button>
          </ActionForm>
          {(types ?? []).length > 0 && (
            <div className="panel section-pad">
              <h2 className="text-lg">Sugjerime nga llojet</h2>
              <p className="muted-copy mb-3">
                Llojet globale ofrojnë template. Aplikimi bëhet nga faqja e
                produktit.
              </p>
              <ul className="space-y-2">
                {(types ?? []).map((t) => (
                  <li key={t.id} className="muted-copy">
                    {t.name}
                    {t.external_key ? ` (${t.external_key})` : ""}
                  </li>
                ))}
              </ul>
              <Link className="soft-link mt-4" href={`/b/${slug}/products`}>
                Hap produktet →
              </Link>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
