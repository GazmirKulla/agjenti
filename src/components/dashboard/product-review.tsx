"use client";

import { useState } from "react";
import { parseAmount } from "@/lib/products/page-extract";

export type ReviewDraft = {
  key: string;
  selected: boolean;
  name: string;
  price: string;
  currency: string;
  description: string;
  sku: string;
  imageUrl: string;
  sourceLabel: string;
  externalId?: string;
  permalink?: string | null;
};

type Option = { id: string; name: string };

export function draftIssue(row: Pick<ReviewDraft, "name" | "price">): string | null {
  if (row.name.trim().length < 2) return "Emri duhet të ketë të paktën 2 karaktere.";
  if (row.price.trim() && parseAmount(row.price) == null) return "Çmimi nuk është i vlefshëm.";
  return null;
}

export function ProductReview({
  rows,
  onChange,
  types,
  workflows,
  pending,
  onSave,
}: {
  rows: ReviewDraft[];
  onChange: (rows: ReviewDraft[]) => void;
  types: Option[];
  workflows: Option[];
  pending: boolean;
  onSave: (payload: {
    items: Array<{
      name: string;
      price: string;
      currency: string;
      description: string;
      sku: string;
      imageUrl: string;
      externalId?: string;
    }>;
    productTypeId: string;
    workflowId: string;
  }) => void;
}) {
  const [typeId, setTypeId] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const selectable = rows.filter((row) => !draftIssue(row));
  const selectedCount = selectable.filter((row) => row.selected).length;
  const allSelected = selectable.length > 0 && selectedCount === selectable.length;

  function patch(key: string, partial: Partial<ReviewDraft>) {
    onChange(
      rows.map((row) => {
        if (row.key !== key) return row;
        const next = { ...row, ...partial };
        if (draftIssue(next)) next.selected = false;
        else if (draftIssue(row)) next.selected = true;
        return next;
      }),
    );
  }

  function toggleAll() {
    onChange(rows.map((row) => (draftIssue(row) ? { ...row, selected: false } : { ...row, selected: !allSelected })));
  }

  return (
    <div className="import-review-wrap">
      <div className="import-review-toolbar">
        <label>
          <input type="checkbox" checked={allSelected} disabled={!selectable.length || pending} onChange={toggleAll} />
          Zgjidh të gjitha
        </label>
        <span>
          {selectedCount === 1 ? "1 produkt i zgjedhur" : `${selectedCount} produkte të zgjedhura`}
        </span>
      </div>
      <ul className="import-review">
        {rows.map((row) => {
          const issue = draftIssue(row);
          const image = safeImage(row.imageUrl);
          const permalink = safePermalink(row.permalink);
          return (
            <li key={row.key} className={row.selected || issue ? "import-review-item" : "import-review-item is-off"}>
              <div className="import-review-top">
                <label className="import-review-pick">
                  <input
                    type="checkbox"
                    checked={row.selected}
                    disabled={Boolean(issue) || pending}
                    onChange={(event) => patch(row.key, { selected: event.target.checked })}
                  />
                  <span>{row.sourceLabel}</span>
                </label>
                {permalink ? (
                  <a href={permalink} target="_blank" rel="noreferrer noopener">
                    Shiko postimin
                  </a>
                ) : null}
              </div>
              <label className="form-label">
                Emri
                <input
                  className="field"
                  value={row.name}
                  aria-invalid={Boolean(issue && row.name.trim().length < 2)}
                  onChange={(event) => patch(row.key, { name: event.target.value })}
                />
              </label>
              <div className="import-review-price">
                <label className="form-label">
                  Çmimi
                  <input
                    className="field"
                    inputMode="decimal"
                    value={row.price}
                    aria-invalid={Boolean(issue && row.price.trim())}
                    onChange={(event) => patch(row.key, { price: event.target.value })}
                  />
                </label>
                <label className="form-label">
                  Monedha
                  <input
                    className="field"
                    maxLength={8}
                    value={row.currency}
                    spellCheck={false}
                    onChange={(event) => patch(row.key, { currency: event.target.value.toUpperCase() })}
                  />
                </label>
              </div>
              <label className="form-label">
                SKU
                <input
                  className="field"
                  value={row.sku}
                  placeholder="opsional"
                  spellCheck={false}
                  onChange={(event) => patch(row.key, { sku: event.target.value })}
                />
              </label>
              <label className="form-label">
                Përshkrimi
                <textarea
                  className="field"
                  rows={2}
                  value={row.description}
                  onChange={(event) => patch(row.key, { description: event.target.value })}
                />
              </label>
              <div className="import-review-media">
                {image ? (
                  <img src={image} alt="" className="import-review-thumb" referrerPolicy="no-referrer" />
                ) : null}
                <label className="form-label">
                  URL e fotos
                  <input
                    className="field"
                    value={row.imageUrl}
                    placeholder="https://"
                    spellCheck={false}
                    onChange={(event) => patch(row.key, { imageUrl: event.target.value })}
                  />
                </label>
              </div>
              {issue ? (
                <p role="alert" className="form-feedback form-feedback-error">
                  {issue}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="form-label">
          Lloji për këto produkte
          <select className="field" value={typeId} onChange={(event) => setTypeId(event.target.value)}>
            <option value="">Pa lloj</option>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
        <label className="form-label">
          Workflow për këto produkte
          <select className="field" value={workflowId} onChange={(event) => setWorkflowId(event.target.value)}>
            <option value="">Pa workflow</option>
            {workflows.map((workflow) => (
              <option key={workflow.id} value={workflow.id}>
                {workflow.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted-copy">Nëse i zgjedh, lloji dhe workflow-i zbatohen te produktet që ruan tani.</p>
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending || selectedCount === 0}
        onClick={() =>
          onSave({
            items: rows
              .filter((row) => row.selected && !draftIssue(row))
              .map((row) => ({
                name: row.name,
                price: row.price,
                currency: row.currency,
                description: row.description,
                sku: row.sku,
                imageUrl: row.imageUrl,
                externalId: row.externalId,
              })),
            productTypeId: typeId,
            workflowId,
          })
        }
      >
        {pending ? "Duke ruajtur…" : "Ruaj të zgjedhurat"}
      </button>
    </div>
  );
}

function safeImage(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safePermalink(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== "www.instagram.com" && url.hostname !== "instagram.com") return null;
    return url.toString();
  } catch {
    return null;
  }
}
