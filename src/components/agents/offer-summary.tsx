import Link from "next/link";
import { createServiceSupabase } from "@/lib/supabase/service";
import { customerPriceText } from "@/lib/products/pricing";

const priceOrRequest = (row: { price_amount: number | null; currency: string | null; price_mode?: string | null; price_max?: number | null; price_unit?: string | null }) =>
  customerPriceText(row) ?? (row.price_mode === "request" ? "Çmimi sipas kërkesës" : "Pa çmim");

/**
 * Rezervimet: what the agent tells customers about each active service, read from the services themselves.
 * Ndrysho opens the service's own editor and comes back here; nothing is copied.
 */
export async function ServicesSummary({ slug, businessId }: { slug: string; businessId: string }) {
  const base = `/b/${encodeURIComponent(slug)}`;
  const db = createServiceSupabase();
  const [active, inactive] = await Promise.all([
    db.from("booking_services").select("id,name,description,price_amount,currency,price_mode,duration_minutes,booking_enabled").eq("business_id", businessId).eq("is_active", true).order("name").limit(50),
    db.from("booking_services").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("is_active", false),
  ]);
  return <section className="panel section-pad offer-summary" aria-labelledby="services-summary-title">
    <h2 id="services-summary-title">Çfarë u thotë Agjenti për shërbimet</h2>
    {active.error ? <p className="muted-copy" role="alert">Shërbimet nuk u lexuan. Rifresko faqen.</p>
      : !active.data?.length ? <p className="muted-copy">Nuk ka shërbime aktive, prandaj Agjenti nuk ofron asnjë. <Link className="inline-link" href={`${base}/services?nga=agents/bookings`}>Shto një shërbim →</Link></p>
      : <ul className="offer-summary-list">{active.data.map(service => <li key={service.id}>
        <div><b>{service.name}</b>
          <small>{priceOrRequest(service)}{service.duration_minutes ? ` · ${service.duration_minutes} min` : " · pa kohëzgjatje"}{service.booking_enabled ? " · Agjenti e rezervon" : " · vetëm informacion, rezervimin e merr stafi"}</small>
          {!service.description?.trim() && <small className="offer-summary-missing">Pa përshkrim: Agjenti nuk ka çfarë të shpjegojë përtej emrit dhe çmimit.</small>}
        </div>
        <Link className="btn btn-ghost" href={`${base}/services?edit=${service.id}&nga=agents/bookings`}>Ndrysho</Link>
      </li>)}</ul>}
    {(inactive.count ?? 0) > 0 && <p className="muted-copy">{inactive.count} {inactive.count === 1 ? "shërbim joaktiv" : "shërbime joaktive"}: Agjenti nuk i ofron.</p>}
  </section>;
}

/** Porositë: what the agent offers and takes orders for, read from the products themselves. */
export async function ProductsSummary({ slug, businessId }: { slug: string; businessId: string }) {
  const base = `/b/${encodeURIComponent(slug)}`;
  const db = createServiceSupabase();
  const [published, drafts] = await Promise.all([
    db.from("products").select("id,name,price_amount,currency,price_mode,price_max,price_unit", { count: "exact" }).eq("business_id", businessId).eq("is_active", true).is("archived_at", null).order("updated_at", { ascending: false }).limit(8),
    db.from("products").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("is_active", false).is("archived_at", null),
  ]);
  const total = published.count ?? published.data?.length ?? 0;
  return <section className="panel section-pad offer-summary" aria-labelledby="products-summary-title">
    <h2 id="products-summary-title">Çfarë ofron Agjenti</h2>
    {published.error ? <p className="muted-copy" role="alert">Produktet nuk u lexuan. Rifresko faqen.</p>
      : !total ? <p className="muted-copy">Nuk ka produkte publike, prandaj Agjenti nuk merr porosi për asnjë. <Link className="inline-link" href={`${base}/products?nga=agents/orders`}>Hap produktet →</Link></p>
      : <>
        <p className="muted-copy">{total} {total === 1 ? "produkt publik" : "produkte publike"}: Agjenti i ofron dhe merr porosi për to.{(drafts.count ?? 0) > 0 ? ` ${drafts.count} në draft nuk i sheh.` : ""}</p>
        <ul className="offer-summary-list">{(published.data ?? []).map(product => <li key={product.id}>
          <div><b>{product.name}</b><small>{priceOrRequest(product)}</small></div>
          <Link className="btn btn-ghost" href={`${base}/products/${product.id}?edit=1&nga=agents/orders`}>Ndrysho</Link>
        </li>)}</ul>
        {total > (published.data?.length ?? 0) && <Link className="inline-link" href={`${base}/products?nga=agents/orders`}>Të gjitha produktet ({total}) →</Link>}
      </>}
  </section>;
}
