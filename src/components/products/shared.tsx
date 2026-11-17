"use client";
import Link from "next/link";
import { Icon } from "@/components/dashboard/icon";
import { useState } from "react";
import { Modal } from "@/components/modal/modal";

export function ProductHeading({
  slug,
  title,
  description,
  back = true,
  names = { plural: "Produktet", singular: "produkt" },
  actions = "all",
}: {
  slug: string;
  title: string;
  description: string;
  /** true: back to the list; or a specific page (e.g. the product when editing it). */
  back?: boolean | { href: string; label: string };
  /** What the business calls its items (e.g. "Listimet" / "listim"). */
  names?: { plural: string; singular: string };
  /** "add": only the add button (the list keeps the rest in its toolbar); "none": no buttons. */
  actions?: "all" | "add" | "none";
}) {
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <header className="product-page-heading">
      <div>
        {back && (
          <Link className="muted-copy" href={typeof back === "object" ? back.href : `/b/${slug}/products`}>
            ‹ {typeof back === "object" ? back.label : names.plural}
          </Link>
        )}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions !== "none" && <div className="product-heading-actions">
        {actions === "all" && <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setMoreOpen(true)}
        >
          Më shumë
        </button>}
        <Link className="btn btn-ghost" href={`/b/${slug}/products/structure`}>
          Struktura
        </Link>
        <Link className="btn btn-primary" href={`/b/${slug}/products/new`}>
          ＋ Shto {names.singular}
        </Link>
      </div>}
      <Modal size="sm" open={moreOpen} onClose={() => setMoreOpen(false)} title="Më shumë">
        <nav className="catalog-more-links" aria-label="Veprime shtesë">
          <Link href={`/b/${slug}/products/imports`}>
            Importo produkte
            <span aria-hidden>→</span>
          </Link>
          <Link href={`/b/${slug}/products/new?method=csv`}>
            Ngarko CSV
            <span aria-hidden>→</span>
          </Link>
          <Link href={`/b/${slug}/products/new?method=instagram`}>
            Nga Instagram
            <span aria-hidden>→</span>
          </Link>
        </nav>
      </Modal>
    </header>
  );
}

export const productMethods = [
  ["manual", "Dorazi", "Shto një produkt duke shkruar emrin, çmimin dhe foton.", "edit"],
  ["csv", "Skedar CSV", "Ngarko shumë produkte njëherësh nga një listë (p.sh. Excel).", "file"],
  ["instagram", "Instagram", "Nxirr produktet nga postimet e Instagram-it të biznesit.", "instagram"],
  ["website", "Faqja e internetit", "Lexo një produkt nga linku i tij në faqen tënde.", "display"],
] as const;

/** The ways to add products, as large cards: a row on wide screens, a column on phones.
 * `compact` keeps them as a small switcher above an open method. */
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
          aria-current={active === key ? "page" : undefined}
        >
          <span className="icon-tile" aria-hidden>
            <Icon name={icon} size={20} />
          </span>
          <span className="product-method-copy">
            <strong>{title}</strong>
            <small>{hint}</small>
          </span>
          <span className="product-method-go" aria-hidden>›</span>
        </Link>
      ))}
    </nav>
  );
}

/** A single hint under the method cards. */
export function ProductMethodTip() {
  return (
    <p className="product-method-tip">
      <span aria-hidden>💡</span>
      <span><strong>Këshillë:</strong> Nëse ke shumë produkte, përdor Skedar CSV për t’i shtuar të gjitha njëherësh. Për tekst ose audio, përshkruaje produktin te Asistenti AI.</span>
    </p>
  );
}

export function ProductTips() {
  return (
    <section className="panel section-pad product-tips">
      <h2>Këshilla të shpejta</h2>
      <p>
        <strong>Produkti nuk përdoret nga Agjenti?</strong>
        <br />
        Kontrollo çmimin, llojin, aktivizimin dhe workflow-in kryesor të biznesit.
      </p>
      <p>
        <strong>Shto përmes Agjentit</strong>
        <br />
        Hap Agjentin dhe përshkruaj produktin me tekst ose audio. Kontrollo
        propozimin para ruajtjes.
      </p>
    </section>
  );
}
