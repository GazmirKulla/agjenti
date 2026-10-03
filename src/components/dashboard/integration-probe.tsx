"use client";

import { useState } from "react";
import type { CatalogProbeResult } from "@/lib/integrations/zana";

export function IntegrationProbe({
  businessId,
  formSelector = "form",
}: {
  businessId: string;
  formSelector?: string;
}) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<CatalogProbeResult | null>(null);

  async function runProbe() {
    if (pending) return;
    setPending(true);
    setResult(null);
    try {
      const form = document.querySelector(formSelector) as HTMLFormElement | null;
      const data = form ? new FormData(form) : null;
      const response = await fetch(
        `/api/businesses/${businessId}/integrations/probe`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            catalog_url: data?.get("catalog_url") ?? undefined,
            orders_url: data?.get("orders_url") ?? undefined,
            api_secret: data?.get("api_secret") ?? undefined,
          }),
        },
      );
      const json = (await response.json()) as CatalogProbeResult & {
        error?: string;
      };
      setResult(json);
    } catch {
      setResult({
        ok: false,
        url: null,
        ordersUrl: null,
        httpStatus: null,
        authSent: false,
        error: "Testi dështoi. Provo përsëri.",
        productCount: 0,
        products: [],
        productTypeCount: null,
        formatCount: null,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="integration-probe">
      <div className="integration-probe-head">
        <div>
          <h3>Testo lidhjen</h3>
          <p className="muted-copy">
            Kontrollon nëse katalogu merret nga URL-të e mësipërme (edhe para
            ruajtjes).
          </p>
        </div>
        <button
          className="btn btn-ghost"
          type="button"
          onClick={runProbe}
          disabled={pending}
        >
          {pending ? "Duke testuar…" : "Testo katalogun"}
        </button>
      </div>

      {result && (
        <div
          className={`integration-probe-result ${result.ok ? "is-ok" : "is-error"}`}
          role="status"
        >
          <p className="integration-probe-status">
            {result.ok
              ? `OK — ${result.productCount} produkte`
              : result.error || "Testi dështoi"}
          </p>
          <dl className="detail-fields">
            <div>
              <dt>URL e katalogut</dt>
              <dd>{result.url || "—"}</dd>
            </div>
            <div>
              <dt>URL e porosive</dt>
              <dd>{result.ordersUrl || "—"}</dd>
            </div>
            <div>
              <dt>HTTP</dt>
              <dd>{result.httpStatus ?? "—"}</dd>
            </div>
            <div>
              <dt>Auth Bearer</dt>
              <dd>{result.authSent ? "Po" : "Jo"}</dd>
            </div>
            {result.productTypeCount != null && (
              <div>
                <dt>Product types</dt>
                <dd>{result.productTypeCount}</dd>
              </div>
            )}
            {result.formatCount != null && (
              <div>
                <dt>Formats</dt>
                <dd>{result.formatCount}</dd>
              </div>
            )}
          </dl>

          {result.products.length > 0 && (
            <div className="integration-probe-products">
              <h4>Çfarë u mor (mostra)</h4>
              <ul>
                {result.products.map((product) => (
                  <li key={product.id}>
                    <strong>{product.name}</strong>
                    <span>
                      {product.productType || "pa tip"}
                      {product.price != null
                        ? ` · ${product.price}${product.currency ? ` ${product.currency}` : ""}`
                        : ""}
                      {` · ${product.formatCount} formate`}
                      {` · ${product.colorCount} ngjyra`}
                    </span>
                  </li>
                ))}
              </ul>
              {result.productCount > result.products.length && (
                <p className="muted-copy">
                  +{result.productCount - result.products.length} të tjera…
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
