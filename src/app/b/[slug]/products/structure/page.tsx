import { redirect } from "next/navigation";
import { ActionForm } from "@/components/dashboard/action-form";
import { ProductHeading } from "@/components/products/shared";
import { ProductFieldsSettings } from "@/components/products/product-fields-settings";
import { StockSettingsForm } from "@/components/products/stock-settings";
import { AgentProductView } from "@/components/products/agent-product-view";
import { agentProductView } from "@/lib/agents/business-grounding";
import { saveItemSetup, saveStockSettings } from "@/lib/items/actions";
import { loadItemSetup } from "@/lib/items/business";
import { ITEM_KINDS } from "@/lib/items/kinds";
import { fieldTemplateFor } from "@/lib/items/field-templates";
import { supportedBusinessCategories } from "@/lib/onboarding/categories";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

/**
 * The shape of the business's products in one place: what it sells, the fields every product has,
 * how stock is counted, and one product exactly as the agent reads it.
 */
export default async function ProductStructurePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: requested } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, requested);
  if (!access) redirect("/auth/continue");
  const slug = access.business.slug;
  const [items, view] = await Promise.all([
    loadItemSetup(access.business.id),
    agentProductView(createServiceSupabase(), access.business.id).catch(() => null),
  ]);
  return (
    <>
      <ProductHeading
        slug={slug}
        names={items.names}
        actions="none"
        back={{ href: `/b/${slug}/products`, label: items.names.plural }}
        title="Struktura"
        description="Çfarë shet biznesi, të dhënat e çdo artikulli, stoku dhe si i sheh Agjenti, në një vend."
      />
      <nav className="product-structure-nav" aria-label="Seksionet e strukturës">
        <a href="#kind">Çfarë shet</a><a href="#fields">Fushat</a><a href="#stock">Stoku</a><a href="#agent-view-title">Si e sheh Agjenti</a>
      </nav>
      <div className="grid gap-5">
        <AgentProductView slug={slug} view={view} />
        <ActionForm action={saveItemSetup.bind(null, slug)} className="panel section-pad grid gap-5">
          <div className="section-title">
            <h2 id="kind">Çfarë shet biznesi</h2>
            <button className="btn btn-primary" type="submit">Ruaj</button>
          </div>
          <p className="muted-copy">
            Lloji sjell fushat e veta (p.sh. m² dhe dhoma për pronat) dhe emrin në menu. Artikujt ekzistues e ruajnë llojin e tyre.
          </p>
          <div className="item-kind-choices">
            {Object.values(ITEM_KINDS).map((kind) => (
              <label key={kind.id} className="item-kind-choice">
                <input type="radio" name="item_kind" value={kind.id} defaultChecked={items.kind.id === kind.id} />
                <span><strong>{kind.plural}</strong><small>{kind.description}</small></span>
              </label>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="form-label">
              Emri në menu (opsional)
              <input className="field" name="item_plural" maxLength={30} defaultValue={items.custom.plural ?? ""} placeholder={items.kind.plural} />
            </label>
            <label className="form-label">
              Një artikull quhet (opsional)
              <input className="field" name="item_singular" maxLength={30} defaultValue={items.custom.singular ?? ""} placeholder={items.kind.singular} />
            </label>
          </div>
        </ActionForm>
        <div id="fields">
          {items.fieldsRead
            ? <ProductFieldsSettings
                slug={slug}
                fields={items.fields}
                fixed={{ name: items.kind.plural, fields: items.kind.fields.map(f => ({ key: f.key, label: f.label })) }}
                suggested={{ category: supportedBusinessCategories.find(([id]) => id === items.category)?.[1] ?? null, fields: fieldTemplateFor(items.category) }}
              />
            : <p className="form-feedback form-feedback-error" role="alert">Fushat nuk u lexuan. Rifresko faqen.</p>}
        </div>
        {items.stockRead
          ? <StockSettingsForm settings={items.stock} action={saveStockSettings.bind(null, slug)} />
          : <p id="stock" className="form-feedback form-feedback-error" role="alert">Cilësimet e stokut nuk u lexuan. Rifresko faqen.</p>}
      </div>
    </>
  );
}
