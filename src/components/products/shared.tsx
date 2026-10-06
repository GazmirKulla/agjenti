import Link from "next/link";
import { IntelligenceTrigger } from "@/components/business-intelligence/trigger";
export function ProductHeading({
  slug,
  title,
  description,
  back = true,
}: {
  slug: string;
  title: string;
  description: string;
  back?: boolean;
}) {
  return (
    <header className="product-page-heading">
      <div>
        {back && (
          <Link className="muted-copy" href={`/b/${slug}/products`}>
            ‹ Produkte
          </Link>
        )}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="product-heading-actions">
        <IntelligenceTrigger>✨ Plotëso me AI</IntelligenceTrigger>
        <Link className="btn btn-ghost" href={`/b/${slug}/products/imports`}>
          Importo
        </Link>
        <Link className="btn btn-primary" href={`/b/${slug}/products/new`}>
          ＋ Shto produkt
        </Link>
      </div>
    </header>
  );
}
export const productMethods = [
  ["manual", "Dorazi", "Shkruaj emrin dhe çmimin", "✧"],
  ["website", "Nga linku", "Skano faqen e produktit", "↗"],
  ["csv", "Skedar CSV", "Ngarko një listë", "▤"],
  ["instagram", "Instagram", "Nxirr nga postimet", "◎"],
  ["audio", "Audio", "Përshkruaj me zë (AI)", "♩"],
] as const;
export function ProductMethods({
  slug,
  compact = false,
  active,
}: {
  slug: string;
  compact?: boolean;
  active?: string;
}) {
  return (
    <nav
      className={compact ? "product-method-list" : "product-method-cards"}
      aria-label="Mënyra e shtimit"
    >
      {productMethods.map(([key, title, hint, icon]) => (
        <Link
          key={key}
          href={`/b/${slug}/products/new?method=${key}`}
          className={active === key ? "is-selected" : ""}
        >
          <span className="icon-tile" aria-hidden>
            {icon}
          </span>
          <div>
            <strong>{title}</strong>
            <small>{hint}</small>
          </div>
          <span aria-hidden>›</span>
        </Link>
      ))}
    </nav>
  );
}
export function ProductTips() {
  return (
    <section className="panel section-pad product-tips">
      <h2>Këshilla të shpejta</h2>
      <p>
        <strong>Produkti nuk përdoret nga Agjenti?</strong>
        <br />
        Kontrollo aktivizimin, çmimin, llojin dhe workflow-n.
      </p>
      <p>
        <strong>Plotëso më shpejt me AI</strong>
        <br />
        Përshkruaje me audio ose skano faqen. Rishiko të dhënat para ruajtjes.
      </p>
    </section>
  );
}
