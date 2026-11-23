"use client";
import { subscribeChanges } from "@/lib/realtime/browser";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { CampaignDashboard, CampaignDetail } from "@/lib/campaigns/service";
import { FOOTER, reasonLabels, statusLabels, type CampaignInput } from "@/lib/campaigns/model";
import "./campaigns.css";
const initial: CampaignInput = { name: "", channel: "instagram", body: "", terms: "", offerExpiresAt: null, hours: 23, orders: "all", lead: null, maxRecipients: 100 };
const preferenceLabels: Record<string, string> = { unknown: "Pa pëlqim të regjistruar", subscribed: "Pranon oferta", unsubscribed: "I çregjistruar" };
export function Campaigns({ businessId, businessName, slug, owner, initialData }: { businessId: string; businessName: string; slug: string; owner: boolean; initialData: CampaignDashboard }) {
  const [data, setData] = useState(initialData), [form, setForm] = useState(initial), [selected, setSelected] = useState<CampaignDetail | null>(null);
  const [testContact, setTestContact] = useState("");
  const [variants, setVariants] = useState<string[]>([]);
  const [step, setStep] = useState(1), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [enabled, setEnabled] = useState(data.settings.enabled), [timezone, setTimezone] = useState(data.settings.timezone), [frequency, setFrequency] = useState(data.settings.frequency_days);
  const change = <K extends keyof CampaignInput>(key: K, value: CampaignInput[K]) => { setForm(f => ({ ...f, [key]: value })); setSelected(null); };
  async function api(action: string, input?: unknown, id?: string) {
    const response = await fetch("/api/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId, action, input, id }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Veprimi dështoi.");
    return result;
  }
  const refresh = useCallback(async (id?: string) => {
    const response = await fetch(`/api/campaigns?businessId=${businessId}${id ? `&id=${id}` : ""}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Nuk u ngarkuan të dhënat.");
    if (id) setSelected(result); else setData(result);
  }, [businessId]);
  async function act(work: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "Lidhja dështoi. Provo përsëri."); }
    finally { setBusy(false); }
  }
  useEffect(() => {

    const unsubscribe = subscribeChanges(["campaigns"], async () => {
      try { await refresh(); if (selected?.id) await refresh(selected.id); }
      catch { setError("Përditësimi dështoi. Dërgimet mund të vazhdojnë në server."); }
    });
    return unsubscribe;
  }, [selected?.id, selected?.status, refresh]);
  const preview = `${form.body.split("{{emri}}").join("Arta").split("{{biznesi}}").join(businessName)}${form.terms ? `\n\n${form.terms}` : ""}\n\n${FOOTER}`;
  const bytes = new TextEncoder().encode(preview).length;
  const label = (key: string | null) => key ? reasonLabels[key] ?? key : "";
  return <main className="campaigns">
    <header className="campaign-heading"><div><p className="campaign-eyebrow">KOMUNIKIM ME KLIENTËT</p><h1>Fushatat</h1><p>Oferta për kontaktet që të kanë shkruar së fundmi dhe kanë pranuar marketingun.</p></div><span className="campaign-pill">Brenda 23 orëve</span></header>
    {!data.globalEnabled && <div className="campaign-notice">Dërgimi është i çaktivizuar nga platforma. Mund të përgatitësh draftet; asnjë mesazh nuk dërgohet.</div>}
    {error && <div role="alert" className="campaign-error">{error}</div>}
    {notice && <div role="status" className="campaign-notice">{notice}</div>}
    <div className="campaign-layout"><section className="campaign-card">
      <div className="campaign-card-title"><h2>Fushatë e re</h2><span>Vetëm tekst · dërgim tani</span></div>
      <nav aria-label="Hapat e fushatës" className="campaign-steps">{["Kush", "Mesazhi", "Kontrollo"].map((title, i) => <button key={title} type="button" disabled={busy} aria-current={step === i + 1 ? "step" : undefined} onClick={() => setStep(i + 1)}><span>{i + 1}</span>{title}</button>)}</nav>
      {step === 1 && <div className="campaign-fields">
        <label>Emri i fushatës<input value={form.name} maxLength={120} onChange={e => change("name", e.target.value)} placeholder="Oferta e fundjavës" /></label>
        <div className="campaign-row"><label>Kanali<select value={form.channel} onChange={e => change("channel", e.target.value as CampaignInput["channel"])}><option value="instagram">Instagram</option><option value="whatsapp">WhatsApp</option></select></label>
        <label>Mesazhi i fundit i klientit<select value={form.hours} onChange={e => change("hours", Number(e.target.value))}>{[1, 3, 6, 12, 23].map(h => <option key={h} value={h}>Në {h} orët e fundit</option>)}</select></label></div>
        <div className="campaign-row"><label>Porositë<select value={form.orders} onChange={e => change("orders", e.target.value as CampaignInput["orders"])}><option value="all">Të gjithë</option><option value="with">Me porosi</option><option value="without">Pa porosi</option><option value="30">Me porosi në 30 ditë</option><option value="90">Me porosi në 90 ditë</option></select></label>
        <label>Lead-i<select value={form.lead ?? ""} onChange={e => change("lead", e.target.value || null)}><option value="">Të gjithë</option><option value="new">I ri</option><option value="contacted">I kontaktuar</option><option value="won">I fituar</option><option value="lost">I humbur</option></select></label></div>
        <label>Maksimumi i marrësve<input type="number" min={1} max={500} value={form.maxRecipients} onChange={e => change("maxRecipients", Number(e.target.value))} /><small>Deri në 500 kontakte. Çdo dërgim përdor një mesazh nga kuota e përbashkët e llogarisë.</small></label>
        <p className="campaign-muted">Përjashtohen kontaktet pa pëlqim, të çregjistruara, të arkivuara dhe ato që kanë marrë fushatë në {data.settings.frequency_days} ditët e fundit. Në nisje zgjidhen kontaktet më të fundit.</p>
        <button className="campaign-primary" disabled={!form.name.trim() || !data.settings.enabled} onClick={() => setStep(2)}>Vazhdo te mesazhi →</button>
      </div>}
      {step === 2 && <div className="campaign-fields">
        <label>Mesazhi<textarea rows={6} maxLength={1000} value={form.body} onChange={e => change("body", e.target.value)} placeholder="Shkruaj ofertën për klientët…" /><small>Variablat: {"{{emri}}"} dhe {"{{biznesi}}"}.</small></label>
        <label>Kushtet që sheh klienti<textarea rows={3} maxLength={1000} value={form.terms} onChange={e => change("terms", e.target.value)} placeholder="Produktet, çmimi dhe afati i ofertës…" /><small>Kushtet dërgohen bashkë me mesazhin dhe njihen nga agjenti. Ky formular nuk ndryshon çmimet e katalogut.</small></label>
        <button disabled={busy || !(form.body.trim() || form.terms.trim())} onClick={() => act(async () => { const result = await api("suggest", { body: form.body, terms: form.terms }); setVariants(result.variants); })}>Propozo 3 variante me AI</button>
        {variants.map((variant, i) => <div className="campaign-example" key={i}><p>{variant}</p><button onClick={() => { change("body", variant); setVariants([]); }}>Përdor këtë variant</button></div>)}
        <label>Skadimi i ofertës (opsional)<input type="datetime-local" value={form.offerExpiresAt ? new Date(Date.parse(form.offerExpiresAt) - new Date(form.offerExpiresAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""} onChange={e => change("offerExpiresAt", e.target.value ? new Date(e.target.value).toISOString() : null)} /><small>Ora lokale e pajisjes. Pas skadimit nuk nisin dërgime dhe agjenti e njeh ofertën si të skaduar.</small></label>
        <div className="campaign-example"><span>SHEMBULL · EMËR ILUSTRUES</span><p>{preview}</p><small>{form.channel === "instagram" ? `${bytes}/1000 bajte, përfshirë kushtet dhe fundin` : `${preview.length}/4096 karaktere`}</small></div>
        {owner && <details><summary>Provë te llogaria ime</summary><div className="campaign-fields"><label>Kontakti im në këtë kanal<select value={testContact} onChange={e => setTestContact(e.target.value)}><option value="">Zgjidh bisedën tënde</option>{data.contacts.filter(c => c.channel === form.channel).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><small>Shkruaji biznesit nga llogaria jote dhe prano ofertat. Prova zbaton të njëjtat rregulla dhe përdor një mesazh nga kuota.</small></label><button disabled={busy || !testContact || !form.body.trim()} onClick={() => act(async () => { const draft = await api("prepare", { ...form, name: `Provë: ${form.name}`.slice(0, 120), testConversationId: testContact }); setSelected(draft); setStep(3); await refresh(); })}>Përgatit provën për konfirmim</button></div></details>}
        <button className="campaign-primary" disabled={busy || !form.body.trim()} onClick={() => act(async () => { const draft = await api("prepare", form); setSelected(draft); setStep(3); await refresh(); })}>{busy ? "Po përgatitet…" : "Përgatit listën dhe pamjen paraprake →"}</button>
      </div>}
      {step === 3 && <div className="campaign-fields">
        {!selected ? <><p>Përgatit mesazhin për të parë listën reale të marrësve.</p><button onClick={() => setStep(2)}>Kthehu te mesazhi</button></> : <>
          {selected.is_test && <p className="campaign-notice">Provë me një kontakt · dërgim real pas konfirmimit.</p>}
          <div className="campaign-summary"><div><strong>{selected.recipients.length}</strong><span>marrës në listën e fiksuar</span></div><div><strong>{statusLabels[selected.status]}</strong><span>{selected.channel === "instagram" ? "Instagram" : "WhatsApp"}</span></div></div>
          {selected.reason && <p className="campaign-notice">{label(selected.reason)}</p>}
          {selected.status === "draft" && <p className="campaign-muted">Konfirmimi vlen për këtë tekst dhe këtë listë, për 15 minuta. Marrësit rikontrollohen para dërgimit. Dërgohet vetëm 09:00–21:00 ({data.settings.timezone}); jashtë orarit marrësit kapërcehen.</p>}
          {selected.recipients.length === 0 && <p className="campaign-notice">Asnjë kontakt nuk plotëson kushtet. Kontrollo pëlqimin dhe filtrat më poshtë.</p>}
          {selected.excluded && Object.keys(selected.excluded).length > 0 && <details><summary>Kontaktet e përjashtuara në pamjen paraprake</summary><ul className="campaign-list">{Object.entries(selected.excluded as Record<string, number>).map(([reason, count]) => <li key={reason}><span>{reason === "recipient_limit" ? "Mbi kufirin e zgjedhur" : reason === "duplicate" ? "I njëjti klient" : label(reason)}</span><b>{count}</b></li>)}</ul></details>}
          <div className="campaign-examples">{selected.recipients.slice(0, 3).map(r => <div className="campaign-example" key={r.id}><span>{r.name} · PAMJE REALE</span><p>{r.body}</p></div>)}</div>
          <div className="campaign-actions">
            {owner && selected.status === "draft" && <button className="campaign-primary" disabled={busy || !data.globalEnabled || !selected.recipients.length} onClick={() => act(async () => { await api("confirm", { count: selected.recipients.length }, selected.id); await refresh(selected.id); await refresh(); })}>Dërgo te {selected.recipients.length} kontakte</button>}
            {!owner && selected.status === "draft" && <p>Pronari duhet ta konfirmojë dërgimin.</p>}
            {owner && selected.status === "running" && <button disabled={busy} onClick={() => act(async () => { await api("pause", {}, selected.id); await refresh(selected.id); })}>Pauzo</button>}
            {owner && selected.status === "paused" && <button disabled={busy || !data.globalEnabled} onClick={() => act(async () => { await api("resume", {}, selected.id); await refresh(selected.id); })}>Vazhdo marrësit në pritje</button>}
            {owner && ["draft", "running", "paused"].some(s => s === selected.status) && <button disabled={busy} onClick={() => act(async () => { await api("cancel", {}, selected.id); await refresh(selected.id); await refresh(); })}>Anulo</button>}
            <button disabled={busy} onClick={() => act(() => refresh(selected.id))}>Rifresko</button>
          </div>
          {selected.status !== "draft" && <p className="campaign-muted">Anulimi ndalon dërgimet që nuk kanë nisur. Rezultatet e panjohura nuk ridërgohen. Tarifat e Meta-s janë të ndara nga kuota e Agjentit.</p>}
          <div className="campaign-counts">{["pending", "sending", "sent", "failed", "uncertain", "skipped"].map(s => <span key={s}>{statusLabels[s]}: <b>{selected.recipients.filter(r => r.status === s).length}</b></span>)}</div>
          <details><summary>Të gjithë marrësit dhe rezultatet ({selected.recipients.length})</summary><ul className="campaign-list">{selected.recipients.map(r => <li key={r.id}><Link href={`/b/${slug}/inbox/${r.conversation_id}`}>{r.name}</Link><span>{statusLabels[r.delivery ?? r.status] ?? r.status}{r.reason ? ` · ${label(r.reason)}` : ""}</span></li>)}</ul></details>
        </>}
      </div>}
    </section>
    <aside className="campaign-card"><div className="campaign-card-title"><h2>Fushatat e fundit</h2><button disabled={busy} onClick={() => { setSelected(null); setForm(initial); setStep(1); }}>+ E re</button></div>
      {!data.campaigns.length && <div className="campaign-empty"><strong>Oferta e parë fillon këtu</strong><p>Krijo mesazhin, kontrollo marrësit dhe konfirmo dërgimin.</p></div>}
      <ul className="campaign-history">{data.campaigns.map(c => <li key={c.id}><button disabled={busy} onClick={() => act(async () => { await refresh(c.id); setStep(3); })}><strong>{c.name}</strong><span>{statusLabels[c.status]} · {c.channel === "instagram" ? "Instagram" : "WhatsApp"}</span><time>{new Date(c.created_at).toLocaleDateString("sq-AL")}</time></button></li>)}</ul>
    </aside></div>
    <section className="campaign-card"><div className="campaign-card-title"><h2>Pëlqimi për oferta</h2><span>Deri në 100 kontaktet më të fundit · 23 orë</span></div><p className="campaign-muted">Kontakti duhet të pranojë shprehimisht ofertat në bisedë. “Vlerëso përgjigjen” interpreton mesazhin e fundit në kontekst; nuk e regjistron kontaktin vetëm sepse pronari klikon.</p>
      {!data.contacts.length && <p>Nuk ka kontakte që kanë shkruar në 23 orët e fundit.</p>}
      <ul className="campaign-list">{data.contacts.map(c => <li key={c.id}><div><Link href={`/b/${slug}/inbox/${c.id}`}>{c.name}</Link><small>{c.channel} · {c.held ? "Pret sqarim të pëlqimit" : preferenceLabels[c.status]}</small>{c.evidence && <small>“{c.evidence}”</small>}</div>{owner && <div className="campaign-actions"><button disabled={busy || !data.settings.enabled} onClick={() => act(async () => { const r = await api("review", {}, c.id); setNotice(r.decision === "subscribe" ? "Përgjigjja u vlerësua. Kontrollo statusin e ruajtur të kontaktit." : r.decision === "unsubscribe" ? "Kërkesa e çregjistrimit u vlerësua. Kontrollo statusin e kontaktit." : "Nuk u gjet pëlqim i ri i qartë. Shiko bisedën ose kërko sqarim."); await refresh(); })}>Vlerëso përgjigjen</button><button disabled={busy || c.status === "unsubscribed"} onClick={() => act(async () => { await api("unsubscribe", {}, c.id); await refresh(); })}>Çregjistro</button></div>}</li>)}</ul>
    </section>
    {owner && <details className="campaign-card"><summary>Cilësimet e fushatave</summary><div className="campaign-fields"><label className="campaign-checkbox"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Aktivizo përgatitjen dhe dërgimin e fushatave</label><p className="campaign-muted">Çregjistrimet vazhdojnë të respektohen edhe kur fushatat janë fikur.</p><div className="campaign-row"><label>Zona kohore<input value={timezone} onChange={e => setTimezone(e.target.value)} /></label><label>Ditët mes dy fushatave për kontakt<input type="number" min={1} max={365} value={frequency} onChange={e => setFrequency(Number(e.target.value))} /></label></div><button className="campaign-primary" disabled={busy} onClick={() => act(async () => { await api("settings", { enabled, timezone, frequencyDays: frequency }); await refresh(); setNotice("Cilësimet u ruajtën."); })}>Ruaj cilësimet</button></div></details>}
  </main>;
}
