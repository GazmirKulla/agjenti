"use client";

import { startTransition, useState } from "react";

type ImportedProduct = {
  name: string;
  description: string | null;
  price: number | null;
  currency: string | null;
  imageUrl: string | null;
  sku: string | null;
};

type PreviewResult = {
  error?: string;
  success?: string;
  product?: ImportedProduct;
};

export function ImportProductLink({
  action,
}: {
  action: (data: FormData) => Promise<PreviewResult>;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<PreviewResult | null>(null);

  function scan(form: HTMLFormElement) {
    const source = form.elements.namedItem("source_url");
    const url = source instanceof HTMLInputElement ? source.value.trim() : "";
    if (!url) {
      setMessage({ error: "Ngjit linkun e produktit." });
      return;
    }
    const data = new FormData();
    data.set("source_url", url);
    setPending(true);
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await action(data);
        if (result.error || !result.product?.name) {
          setMessage({ error: result.error || "Nuk gjeta produktin në këtë faqe." });
        } else {
          fillProduct(form, result.product);
          setMessage({
            success:
              result.success ||
              "Kontrollo të dhënat. Nuk ruhet derisa të klikosh Ruaj produktin.",
          });
        }
      } catch {
        setMessage({ error: "Skanimi dështoi. Provo përsëri." });
      } finally {
        setPending(false);
      }
    });
  }

  return (
    <fieldset className="import-link">
      <legend className="font-semibold">Nga linku i produktit</legend>
      <p className="muted-copy">
        Ngjit linkun e faqes së produktit, nga çdo dyqan. Lexohen emri, çmimi dhe
        përshkrimi. I sheh këtu dhe i ruan vetëm kur klikon Ruaj produktin.
      </p>
      <div className="import-link-row">
        <input
          name="source_url"
          className="field"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={2000}
          placeholder="https://…/produkti"
          aria-label="Linku i produktit"
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const form = event.currentTarget.closest("form");
            if (form && !pending) scan(form);
          }}
        />
        <button
          type="button"
          className="btn btn-ghost"
          disabled={pending}
          onClick={(event) => {
            const form = event.currentTarget.closest("form");
            if (!form) {
              setMessage({ error: "Nuk u gjet forma." });
              return;
            }
            scan(form);
          }}
        >
          {pending ? "Duke skanuar…" : "Skano"}
        </button>
      </div>
      {message?.error ? (
        <p role="alert" className="form-feedback form-feedback-error">
          {message.error}
        </p>
      ) : message?.success ? (
        <p role="status" className="form-feedback form-feedback-success">
          {message.success}
        </p>
      ) : null}
    </fieldset>
  );
}

function fillProduct(form: HTMLFormElement, product: ImportedProduct) {
  writeField(form, "name", product.name);
  writeField(form, "description", product.description ?? "");
  if (product.price != null) writeField(form, "price", priceValue(product.price));
  if (product.currency && /^[A-Z]{3}$/.test(product.currency)) {
    writeField(form, "currency", product.currency);
  }
  if (product.imageUrl) writeField(form, "image_url", product.imageUrl);
  if (product.sku) writeField(form, "sku", product.sku);
  const name = form.elements.namedItem("name");
  if (name instanceof HTMLInputElement) name.focus();
}

function writeField(form: HTMLFormElement, fieldName: string, value: string) {
  const field = form.elements.namedItem(fieldName);
  if (
    field instanceof HTMLInputElement ||
    field instanceof HTMLTextAreaElement ||
    field instanceof HTMLSelectElement
  ) {
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function priceValue(price: number): string {
  if (!Number.isFinite(price)) return "";
  return Number.isInteger(price) ? String(price) : price.toFixed(2);
}
