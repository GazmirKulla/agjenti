import { ActionForm } from "@/components/dashboard/action-form";
import { RecordBrowser } from "@/components/dashboard/record-browser";
import { PageHeading, StatusBadge } from "@/components/dashboard/ui";
import { redirect } from "next/navigation";
import {
  createGlobalProductType,
  deleteGlobalProductType,
  updateGlobalProductType,
} from "@/lib/product-types/actions";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";

const DEFAULT_STEPS_JSON = JSON.stringify(
  [
    { key: "confirm_product", kind: "confirm", label: "Konfirmim" },
    { key: "collect_customer", kind: "customer", label: "Adresa" },
  ],
  null,
  2,
);

export default async function AdminProductTypesPage() {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/auth/continue");

  const db = createServiceSupabase();
  const { data: types, error } = await db
    .from("product_types")
    .select(
      "id,name,description,external_key,sort_order,is_active,product_type_steps(key,position,kind,config)",
    )
    .order("sort_order")
    .order("name");
  if (error) throw new Error("Nuk u ngarkuan llojet.");

  return (
    <>
      <PageHeading
        eyebrow="PLATFORMA"
        title="Llojet e produkteve"
        description="Katalog global. Bizneset i zgjedhin këto lloje; template-i sugjeron workflow, pa e lidhur drejtpërdrejt me biznesin."
      />
      <RecordBrowser
        listTitle="Llojet globale"
        placeholder="Kërko lloj…"
        emptyTitle="Nuk ka lloje"
        emptyDescription="Shto llojin e parë global dhe hapat e sugjeruar."
        createLabel="Shto lloj"
        createForm={
          <ActionForm
            action={createGlobalProductType}
            className="grid gap-4"
          >
            <label className="form-label">
              Emri
              <input name="name" className="field" required minLength={2} />
            </label>
            <label className="form-label">
              Përshkrimi
              <textarea name="description" className="field" rows={3} />
            </label>
            <label className="form-label">
              Çelësi i jashtëm
              <input
                name="external_key"
                className="field"
                placeholder="p.sh. personalized"
              />
            </label>
            <label className="form-label">
              Renditja
              <input
                name="sort_order"
                type="number"
                className="field"
                defaultValue={0}
              />
            </label>
            <label className="form-label">
              Template steps (JSON)
              <textarea
                name="steps_json"
                className="field font-mono text-sm"
                rows={8}
                defaultValue={DEFAULT_STEPS_JSON}
                required
              />
            </label>
            <label className="toggle-label">
              <span>Aktiv</span>
              <input
                className="switch-input"
                type="checkbox"
                name="is_active"
                defaultChecked
              />
            </label>
            <button className="btn btn-primary" type="submit">
              Ruaj llojin
            </button>
          </ActionForm>
        }
        records={(types ?? []).map((t) => {
          const steps = (
            (t.product_type_steps as {
              key: string;
              position: number;
              kind: string;
              config: { label?: string };
            }[]) ?? []
          ).sort((a, b) => a.position - b.position);
          const stepsJson = JSON.stringify(
            steps.map((s) => ({
              key: s.key,
              kind: s.kind,
              label: s.config?.label || s.key,
            })),
            null,
            2,
          );
          return {
            id: t.id,
            title: t.name,
            subtitle: t.external_key || "Pa çelës",
            badge: (
              <StatusBadge status={t.is_active ? "connected" : "paused"} />
            ),
            detail: (
              <>
                <div className="detail-header">
                  <div>
                    <h2>{t.name}</h2>
                    <p>{t.description || "Pa përshkrim"}</p>
                  </div>
                  <StatusBadge status={t.is_active ? "connected" : "paused"} />
                </div>
                <div className="detail-block">
                  <h3>Hapat e sugjeruar</h3>
                  <ol className="mt-3 space-y-2">
                    {steps.map((s, i) => (
                      <li key={s.key} className="muted-copy">
                        {i + 1}. {s.config?.label || s.key}{" "}
                        <span>({s.kind})</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="detail-block">
                  <h3>Ndrysho</h3>
                  <ActionForm
                    action={updateGlobalProductType}
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
                      Renditja
                      <input
                        name="sort_order"
                        type="number"
                        className="field"
                        defaultValue={t.sort_order}
                      />
                    </label>
                    <label className="form-label">
                      Template steps (JSON)
                      <textarea
                        name="steps_json"
                        className="field font-mono text-sm"
                        rows={8}
                        defaultValue={stepsJson}
                        required
                      />
                    </label>
                    <label className="toggle-label">
                      <span>Aktiv</span>
                      <input
                        className="switch-input"
                        type="checkbox"
                        name="is_active"
                        defaultChecked={t.is_active}
                      />
                    </label>
                    <button className="btn btn-primary" type="submit">
                      Ruaj ndryshimet
                    </button>
                  </ActionForm>
                </div>
                <div className="detail-block">
                  <h3>Fshi</h3>
                  <ActionForm action={deleteGlobalProductType} className="mt-4">
                    <input type="hidden" name="id" value={t.id} />
                    <button className="btn btn-ghost" type="submit">
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
