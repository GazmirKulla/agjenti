"use client";
import { useState } from "react";
import { ActionForm, type ActionResult } from "@/components/dashboard/action-form";
import {
  stockCustomerSentence, stockDeductLabels, stockDeducts, stockDisplayLabels, stockDisplays, stockModeLabels, stockModes,
  type StockSettings,
} from "@/lib/products/stock";

/**
 * The business's stock rules, each with its consequence in plain words: when an order takes stock,
 * what a customer who asks hears (a live sample sentence) and how a new product starts.
 */
export function StockSettingsForm({ settings, action }: { settings: StockSettings; action: (data: FormData) => Promise<ActionResult | void> }) {
  const [draft, setDraft] = useState(settings);
  const set = (patch: Partial<StockSettings>) => setDraft(current => ({ ...current, ...patch }));
  // What was last saved: the page's settings, then each successful save (the onboarding step does not reload).
  const [base, setBase] = useState(settings);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  return (
    <ActionForm action={action} className="panel section-pad grid gap-5" onSuccess={() => setBase(draft)}>
      <div className="section-title">
        <h2 id="stock">Stoku</h2>
        <span className="section-title-actions">
          {dirty && <span className="unsaved-note" role="status">Ndryshime të paruajtura</span>}
          <button className="btn btn-primary" type="submit">Ruaj</button>
        </span>
      </div>
      <p className="muted-copy">
        Stoku është opsional për çdo produkt. Këtu vendos rregullat e biznesit; sasinë e çdo produkti e vendos te forma e tij, te seksioni “Gjendja”.
      </p>

      <fieldset className="grid gap-2">
        <legend className="font-semibold">Kur e ul stokun një porosi?</legend>
        <div className="product-stock-modes">
          {stockDeducts.map(option => (
            <label key={option} className={`product-stock-mode${draft.deduct === option ? " is-selected" : ""}`}>
              <input type="radio" name="deduct" value={option} checked={draft.deduct === option} onChange={() => set({ deduct: option })} />
              <span><strong>{stockDeductLabels[option].label}</strong><small>{stockDeductLabels[option].effect}</small></span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="font-semibold">Çfarë i thotë Agjenti klientit?</legend>
        <div className="product-stock-modes">
          {stockDisplays.map(option => (
            <label key={option} className={`product-stock-mode${draft.display === option ? " is-selected" : ""}`}>
              <input type="radio" name="display" value={option} checked={draft.display === option} onChange={() => set({ display: option })} />
              <span><strong>{stockDisplayLabels[option].label}</strong><small>{stockDisplayLabels[option].hint}</small></span>
            </label>
          ))}
        </div>
        {draft.display === "low" && (
          <label className="form-label product-stock-threshold">
            “Pak copë” kur mbeten sa ose më pak
            <input className="field" type="number" name="lowThreshold" min={1} max={1000} step={1} value={draft.lowThreshold}
              onChange={e => set({ lowThreshold: Math.max(1, Math.min(1000, Math.round(Number(e.target.value) || 1))) })} />
          </label>
        )}
        {draft.display !== "low" && <input type="hidden" name="lowThreshold" value={draft.lowThreshold} />}
        <ul className="product-stock-samples" aria-label="Shembuj">
          <li><span>Me 12 copë:</span> {stockCustomerSentence(12, draft)}</li>
          {draft.display === "low" && <li><span>Me {draft.lowThreshold} copë:</span> {stockCustomerSentence(draft.lowThreshold, draft)}</li>}
          <li><span>Me 0 copë:</span> {stockCustomerSentence(0, draft)}</li>
        </ul>
      </fieldset>

      <label className="form-label">
        Një produkt i ri fillon me
        <select className="field" name="defaultMode" value={draft.defaultMode} onChange={e => set({ defaultMode: e.target.value as StockSettings["defaultMode"] })}>
          {stockModes.map(option => <option key={option} value={option}>{stockModeLabels[option].label}</option>)}
        </select>
        <small className="muted-copy">{stockModeLabels[draft.defaultMode].hint} E ndryshon te çdo produkt.</small>
      </label>
    </ActionForm>
  );
}
