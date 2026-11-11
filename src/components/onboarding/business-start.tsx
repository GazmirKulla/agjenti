"use client";
import { useState } from "react";
import { createBusiness } from "@/lib/onboarding/actions";

/** Onboarding step 1: the business name and where customers find it. The
 * Instagram and website are confirmed on the next screen before anything is read. */
export function BusinessStart({ initialName = "" }: { initialName?: string }) {
  const [name, setName] = useState(initialName);
  const [instagram, setInstagram] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || name.trim().length < 2) return;
    setBusy(true); setError("");
    const form = new FormData();
    form.set("name", name.trim());
    form.set("instagramUsername", instagram.trim());
    form.set("website", website.trim());
    const result = await createBusiness(form).catch(() => ({ error: "Nuk u lidhëm me shërbimin. Provo përsëri pa mbyllur faqen." } as { error?: string; destination?: string }));
    if (result.destination) { window.location.assign(result.destination); return; }
    setError(result.error || "Hapësira nuk u krijua. Provo përsëri.");
    setBusy(false);
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <fieldset disabled={busy}>
        <div className="onboarding-question">
          <span className="onboarding-eyebrow">NJË FILLIM I THJESHTË</span>
          <h1>Le të përgatisim biznesin tënd</h1>
          <p>Emri i biznesit dhe ku të gjejnë klientët. Agjenti lexon vetëm atë që është publike, pasi ta konfirmosh.</p>
        </div>
        <div className="onboarding-intro onboarding-sources">
          <label htmlFor="business-name">Si quhet biznesi yt?</label>
          <input id="business-name" autoComplete="organization" required minLength={2} maxLength={100}
            placeholder="p.sh. Zana Store" value={name} onChange={(event) => setName(event.target.value)} />
          <label htmlFor="business-instagram">Instagram i biznesit <small>(opsional)</small></label>
          <input id="business-instagram" value={instagram} onChange={(event) => setInstagram(event.target.value)} placeholder="@dyqani.im"
            maxLength={80} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          <label htmlFor="business-website">Website <small>(opsional)</small></label>
          <input id="business-website" value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="zana.al" inputMode="url"
            maxLength={2000} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          <small className="onboarding-hint">Lidhja e Instagram-it për t&apos;u përgjigjur klientëve bëhet në hapin e fundit.</small>
        </div>
        {error && <p className="onboarding-error" role="alert">{error}</p>}
        <div className="onboarding-actions">
          <a href="/privacy">Privatësia</a>
          <div className="onboarding-actions-end">
            <button className="onboarding-next" type="submit" disabled={busy || name.trim().length < 2}>
              {busy ? "Duke krijuar…" : "Vazhdo"}
            </button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
