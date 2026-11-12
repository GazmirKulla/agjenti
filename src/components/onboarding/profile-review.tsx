"use client";
import { useEffect, useMemo, useState } from "react";
import type { ContinuationItem } from "@/lib/onboarding/continuation";
import type { SuggestedAnswer } from "@/lib/onboarding/suggest";

type Draft = { values: string[] } | { text: string };
const empty = (draft: Draft | undefined) => !draft || ("text" in draft ? !draft.text.trim() : !draft.values.length);
const same = (a: Draft | undefined, b: Draft | undefined) =>
  JSON.stringify(a && ("text" in a ? a.text.trim() : [...a.values].sort())) === JSON.stringify(b && ("text" in b ? b.text.trim() : [...b.values].sort()));
const current = (item: ContinuationItem): Draft | undefined =>
  item.status !== "answered" ? undefined : typeof item.value === "string" ? { text: item.value } : { values: item.value ?? [] };
const label = (item: ContinuationItem, draft: Draft) =>
  "text" in draft ? draft.text.split("\n").filter(Boolean).join(", ") : draft.values.map((v) => item.options.find((o) => o.value === v)?.label ?? v).join(", ");

/** End of onboarding step 3: the profile questions filled from what the agent
 * learned. Open questions come preselected; an answer the owner already gave
 * is kept, with the agent's different suggestion one click away. Only what
 * changes is saved, through the same checked answer endpoint. */
export function ProfileReview({ slug, onDone }: { slug: string; onDone: () => void }) {
  const path = `/api/business-onboarding?slug=${encodeURIComponent(slug)}`;
  const [items, setItems] = useState<ContinuationItem[] | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, SuggestedAnswer>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    Promise.all([
      fetch(path, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch(`${path}&suggest=1`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([view, suggested]) => {
      if (!live) return;
      // The business profile; the questions about the agent are asked with its instructions.
      const list: ContinuationItem[] = (view?.continuation?.items ?? []).filter((item: ContinuationItem) => item.step === "profile");
      const found: Record<string, SuggestedAnswer> = suggested?.suggestions ?? {};
      const initial: Record<string, Draft> = {};
      for (const item of list) {
        const given = current(item);
        const draft = given ?? found[item.field];
        if (draft) initial[item.field] = draft;
      }
      setItems(list); setSuggestions(found); setDrafts(initial);
    }).catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [path]);

  const changed = useMemo(() => (items ?? []).filter((item) => !empty(drafts[item.field]) && !same(drafts[item.field], current(item))), [items, drafts]);
  if (!items) return <div className="onboarding-learning" role="status"><span className="onboarding-spinner" aria-hidden="true" /> Agjenti po plotëson profilin nga ajo që mësoi…</div>;
  const filled = Object.keys(suggestions).length;

  async function save() {
    setBusy(true); setError("");
    try {
      // An answer can make another question unnecessary (it then leaves the list).
      let asked = new Set(changed.map((item) => item.field));
      for (const item of changed) {
        if (!asked.has(item.field)) continue;
        const draft = drafts[item.field];
        const answer = "text" in draft ? { text: draft.text.trim() } : { values: draft.values };
        const response = await fetch(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field: item.field, answer }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(`${item.title}: ${result.error || "nuk u ruajt."}`);
        const items: ContinuationItem[] | undefined = result.continuation?.items;
        if (items) asked = new Set(items.map((entry) => entry.field));
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Profili nuk u ruajt. Provo përsëri.");
      setBusy(false);
    }
  }

  return (
    <section className="profile-review" aria-label="Profili i biznesit">
      <p className="profile-review-lead">
        {filled ? `Agjenti plotësoi ${filled} nga ${items.length} pyetje nga ajo që mësoi. Kontrolloji dhe ndrysho çfarë nuk është e saktë.`
          : "Plotëso çfarë di; çdo pyetje mund ta lësh për më vonë."}
      </p>
      <ul className="profile-review-list">
        {items.map((item) => {
          const draft = drafts[item.field];
          const suggestion = suggestions[item.field];
          const given = current(item);
          const fromScan = !given && suggestion && same(draft, suggestion);
          const different = given && suggestion && !same(given, suggestion) && !same(draft, suggestion);
          const choice = item.kind !== "text" && item.kind !== "list";
          return (
            <li key={item.field} className={fromScan ? "is-suggested" : undefined}>
              <div className="profile-review-head">
                <strong>{item.title}</strong>
                {fromScan && <span className="profile-review-tag">Nga skanimi</span>}
              </div>
              {choice ? (
                <div className="profile-review-options" role={item.kind === "multiple" ? "group" : "radiogroup"} aria-label={item.title}>
                  {item.options.map((option) => {
                    const values = draft && "values" in draft ? draft.values : [];
                    const on = values.includes(option.value);
                    return (
                      <button key={option.value} type="button" disabled={busy} role={item.kind === "multiple" ? "checkbox" : "radio"} aria-checked={on}
                        className={on ? "is-on" : undefined}
                        onClick={() => setDrafts({ ...drafts, [item.field]: { values: item.kind === "multiple" ? (on ? values.filter((v) => v !== option.value) : [...values, option.value]) : [option.value] } })}>
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <textarea className="field" rows={item.kind === "list" ? 3 : 2} maxLength={2000} disabled={busy} aria-label={item.title}
                  placeholder={item.kind === "list" ? "Një në çdo rresht" : "Shkruaj përgjigjen ose lëre bosh"}
                  value={draft && "text" in draft ? draft.text : ""} onChange={(e) => setDrafts({ ...drafts, [item.field]: { text: e.target.value } })} />
              )}
              {different && (
                <p className="profile-review-hint">
                  Agjenti sugjeron: <em>{label(item, suggestion)}</em>{" "}
                  <button type="button" className="profile-review-use" disabled={busy} onClick={() => setDrafts({ ...drafts, [item.field]: suggestion })}>Përdor sugjerimin</button>
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="onboarding-error" role="alert">{error}</p>}
      <div className="onboarding-actions">
        <button type="button" className="onboarding-back" disabled={busy} onClick={onDone}>Më vonë</button>
        <div className="onboarding-actions-end">
          <button type="button" className="onboarding-next" disabled={busy} onClick={() => void (changed.length ? save() : onDone())}>
            {busy ? "Duke ruajtur…" : changed.length ? `Ruaj profilin (${changed.length})` : "Vazhdo"}
          </button>
        </div>
      </div>
    </section>
  );
}
