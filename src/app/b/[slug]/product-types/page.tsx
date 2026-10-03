import { ActionForm } from "@/components/dashboard/action-form";
import { RecordBrowser } from "@/components/dashboard/record-browser";
import { PageHeading, StatusBadge } from "@/components/dashboard/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  createProductType,
  deleteProductType,
  seedDefaultProductTypes,
  updateProductType,
} from "@/lib/product-types/actions";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

export default async function ProductTypesPage({
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
  const [typeResult, workflowResult, productCountResult] = await Promise.all([
    db
      .from("product_types")
      .select("id,name,description,external_key,workflow_id,created_at")
      .eq("business_id", access.business.id)
      .order("name"),
    db
      .from("workflows")
      .select("id,name")
      .eq("business_id", access.business.id)
      .order("name"),
    db
      .from("products")
      .select("id,product_type_id")
      .eq("business_id", access.business.id),
  ]);
  if (typeResult.error || workflowResult.error || productCountResult.error)
    throw new Error("Nuk u ngarkuan të dhënat.");

  const types = typeResult.data ?? [];
  const workflows = workflowResult.data ?? [];
  const products = productCountResult.data ?? [];
  const productCountByType = products.reduce<Record<string, number>>(
    (acc, p) => {
      if (!p.product_type_id) return acc;
      acc[p.product_type_id] = (acc[p.product_type_id] ?? 0) + 1;
      return acc;
    },
    {},
  );

  return (
    <>
      <PageHeading
        eyebrow="Llojet"
        title={`Llojet e produkteve · ${access.business.name}`}
        description="Lloji lidh produktin me workflow-n që Agjenti AI ndjek për porosinë."
      >
        <ActionForm action={seedDefaultProductTypes.bind(null, slug)}>
          <button className="btn btn-ghost" type="submit">
            Shto llojet tipike
          </button>
        </ActionForm>
      </PageHeading>

      <RecordBrowser
        listTitle="Llojet e produkteve"
        placeholder="Kërko lloj…"
        emptyTitle="Ende nuk ka lloje"
        emptyDescription="Shto një lloj manualisht ose importo llojet tipike me workflow."
        createLabel="Shto lloj"
        createForm={
          <ActionForm
            action={createProductType.bind(null, slug)}
            className="grid gap-4"
          >
            <label className="form-label">
              Emri
              <input
                name="name"
                className="field"
                placeholder="P.sh. Me personalizim"
                required
                minLength={2}
              />
            </label>
            <label className="form-label">
              Përshkrimi
              <textarea
                name="description"
                className="field"
                rows={3}
                placeholder="Çfarë dallon këtë lloj dhe çfarë duhet të mbledhë agjenti."
              />
            </label>
            <label className="form-label">
              Çelësi i jashtëm
              <input
                name="external_key"
                className="field"
                placeholder="p.sh. personalized"
              />
              <small className="muted-copy">
                Përdoret për lidhje me katalogë të jashtëm (Zana etj.). Nëse e
                lë bosh, gjenerohet nga emri.
              </small>
            </label>
            <label className="form-label">
              Workflow i porosisë
              <select name="workflow_id" className="field" defaultValue="">
                <option value="">Pa workflow (zgjidh më vonë)</option>
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="toggle-label">
              <span>
                Krijo workflow të thjeshtë
                <small>
                  Nëse nuk zgjedh një workflow ekzistues, krijon hapat bazë
                  (konfirmim + adresë).
                </small>
              </span>
              <input
                className="switch-input"
                type="checkbox"
                name="create_workflow"
                defaultChecked={!workflows.length}
              />
            </label>
            <button className="btn btn-primary" type="submit">
              Ruaj llojin
            </button>
          </ActionForm>
        }
        records={types.map((t) => {
          const workflow = workflows.find((w) => w.id === t.workflow_id);
          const linked = productCountByType[t.id] ?? 0;
          return {
            id: t.id,
            title: t.name,
            subtitle: workflow?.name || "Pa workflow",
            badge: (
              <StatusBadge status={workflow ? "connected" : "draft"} />
            ),
            detail: (
              <>
                <div className="detail-header">
                  <div>
                    <h2>{t.name}</h2>
                    <p>{t.description || "Pa përshkrim"}</p>
                  </div>
                  <StatusBadge status={workflow ? "connected" : "draft"} />
                </div>
                <div className="detail-block">
                  <h3>Informacioni i llojit</h3>
                  <dl className="detail-fields">
                    <div>
                      <dt>Çelësi i jashtëm</dt>
                      <dd>{t.external_key || "—"}</dd>
                    </div>
                    <div>
                      <dt>Workflow</dt>
                      <dd>{workflow?.name || "—"}</dd>
                    </div>
                    <div>
                      <dt>Produkte të lidhura</dt>
                      <dd>{linked}</dd>
                    </div>
                  </dl>
                </div>
                <div className="detail-block">
                  <h3>Ndrysho llojin</h3>
                  <ActionForm
                    action={updateProductType.bind(null, slug)}
                    className="grid gap-3 mt-4"
                  >
                    <input type="hidden" name="id" value={t.id} />
                    <label className="form-label">
                      Emri
                      <input
                        name="name"
                        className="field"
                        defaultValue={t.name}
                        required
                        minLength={2}
                      />
                    </label>
                    <label className="form-label">
                      Përshkrimi
                      <textarea
                        name="description"
                        className="field"
                        rows={3}
                        defaultValue={t.description ?? ""}
                      />
                    </label>
                    <label className="form-label">
                      Çelësi i jashtëm
                      <input
                        name="external_key"
                        className="field"
                        defaultValue={t.external_key ?? ""}
                      />
                    </label>
                    <label className="form-label">
                      Workflow i porosisë
                      <select
                        name="workflow_id"
                        className="field"
                        defaultValue={t.workflow_id ?? ""}
                      >
                        <option value="">Pa workflow</option>
                        {workflows.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="btn btn-primary" type="submit">
                      Ruaj ndryshimet
                    </button>
                  </ActionForm>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Link
                      className="soft-link"
                      href={`/b/${slug}/workflows`}
                    >
                      Hap workflow-t →
                    </Link>
                    <Link className="soft-link" href={`/b/${slug}/products`}>
                      Hap produktet →
                    </Link>
                  </div>
                </div>
                <div className="detail-block">
                  <h3>Fshi llojin</h3>
                  <p className="muted-copy">
                    Fshirja hiqet vetëm nëse asnjë produkt nuk e përdor këtë
                    lloj. Produktet mbajnë çmimin; lidhja me llojin hiqet.
                  </p>
                  <ActionForm
                    action={deleteProductType.bind(null, slug)}
                    className="mt-4"
                    successMessage="Lloji u fshi."
                  >
                    <input type="hidden" name="id" value={t.id} />
                    <button
                      className="btn btn-ghost"
                      type="submit"
                      disabled={linked > 0}
                    >
                      Fshi llojin
                    </button>
                  </ActionForm>
                </div>
              </>
            ),
          };
        })}
      />
    </>
  );
}
