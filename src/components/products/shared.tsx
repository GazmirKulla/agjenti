"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

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
  const [moreOpen, setMoreOpen] = useState(false);
  const moreDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = moreDialog.current;
    if (!dialog) return;
    if (moreOpen) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [moreOpen]);

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
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setMoreOpen(true)}
        >
          Më shumë
        </button>
        <Link className="btn btn-primary" href={`/b/${slug}/products/new`}>
          ＋ Shto produkt
        </Link>
      </div>
      <dialog
        ref={moreDialog}
        className="record-create-dialog catalog-dialog"
        aria-labelledby="product-more-title"
        onClose={() => setMoreOpen(false)}
        onClick={(e) => {
          if (e.target === moreDialog.current) setMoreOpen(false);
        }}
      >
        <div className="record-create-dialog-body">
          <header className="record-create-dialog-head">
            <h2 id="product-more-title">Më shumë</h2>
            <button
              className="btn btn-ghost"
              type="button"
              aria-label="Mbyll"
              onClick={() => setMoreOpen(false)}
            >
              ×
            </button>
          </header>
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
        </div>
      </dialog>
    </header>
  );
}

export const productMethods = [
  ["manual", "Dorazi", "Shkruaj emrin dhe çmimin", "✧"],
  ["csv", "Skedar CSV", "Ngarko një listë", "▤"],
  ["instagram", "Instagram", "Nxirr nga postimet", "◎"],
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
        Kontrollo çmimin, llojin, rrjedhën e lidhur dhe aktivizimin.
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
