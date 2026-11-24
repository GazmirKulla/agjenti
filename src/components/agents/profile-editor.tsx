"use client";
import { useState } from "react";
import { ActionForm, type ActionResult } from "@/components/dashboard/action-form";
import { socialNetworks, weekdays, type BusinessProfile, type HoursException, type Interval, type Social } from "@/lib/business-profile/model";
import type { ProfileSuggestion } from "@/lib/business-profile/service";

type Section = "identity" | "contacts" | "location" | "hours";
const networkLabels: Record<Social["network"], string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", whatsapp: "WhatsApp", other: "Tjetër" };
const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().filter(key => (value as Record<string, unknown>)[key] !== undefined).map(key => `${key}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}` : JSON.stringify(value);
// Monday first, as owners read a week.
const weekOrder = [1, 2, 3, 4, 5, 6, 0];

/** The public profile in four groups, saved once with Ruaj through the shared configuration change. */
export function ProfileEditor({ initial, updatedAt, requestId, timezone, suggestions, settingsHref, action }: {
  initial: BusinessProfile; updatedAt: string; requestId: string; timezone: string | null; suggestions: ProfileSuggestion[]; settingsHref: string;
  action: (data: FormData) => Promise<ActionResult | void>;
}) {
  const [profile, setProfile] = useState<BusinessProfile>(initial);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const set = <S extends Section>(section: S, patch: Partial<NonNullable<BusinessProfile[S]>>) =>
    setProfile(current => ({ ...current, [section]: { ...(current[section] ?? {}), ...patch } }));
  const reveal = (key: string) => { setShown(current => new Set(current).add(key)); requestAnimationFrame(() => document.getElementById(`profile-${key}`)?.focus()); };
  // Key order differs between what was edited and what the server stored; compare the content.
  const dirty = stable(profile) !== stable(initial);

  // A field the profile does not have yet is an action, never an empty "closed" value.
  const field = (section: Section, key: string, label: string, add: string, value: string | undefined, input: (props: { id: string; value: string; onChange: (value: string) => void }) => React.ReactNode, hint?: string) => {
    if (!value && !shown.has(key)) return <button type="button" className="profile-add" onClick={() => reveal(key)}>＋ {add}</button>;
    return <label className="form-label" htmlFor={`profile-${key}`}>{label}
      {input({ id: `profile-${key}`, value: value ?? "", onChange: next => set(section, { [key]: next } as never) })}
      {hint && <small className="muted-copy">{hint}</small>}
    </label>;
  };
  const text = (props: { id: string; value: string; onChange: (value: string) => void }, type = "text", placeholder?: string) =>
    <input id={props.id} className="field" type={type} value={props.value} placeholder={placeholder} onChange={event => props.onChange(event.target.value)} />;
  const area = (props: { id: string; value: string; onChange: (value: string) => void }, rows = 3) =>
    <textarea id={props.id} className="field" rows={rows} value={props.value} onChange={event => props.onChange(event.target.value)} />;

  const weekly = profile.hours?.weekly ?? [], closed = profile.hours?.closed_days ?? [], exceptions = profile.hours?.exceptions ?? [];
  const setHours = (patch: Partial<NonNullable<BusinessProfile["hours"]>>) => set("hours", patch);
  const dayState = (day: number) => weekly.some(item => item.day === day) ? "open" : closed.includes(day) ? "closed" : "unknown";
  const setDay = (day: number, state: string) => setHours({
    weekly: state === "open" ? [...weekly.filter(item => item.day !== day), { day, open: "09:00", close: "17:00" }] : weekly.filter(item => item.day !== day),
    closed_days: state === "closed" ? [...closed.filter(item => item !== day), day] : closed.filter(item => item !== day),
  });
  const setInterval = (index: number, patch: Partial<Interval>) => setHours({ weekly: weekly.map((item, i) => i === index ? { ...item, ...patch } : item) });
  const socials = profile.contacts?.socials ?? [];

  return <ActionForm action={action} className="profile-editor">
    <input type="hidden" name="profile" value={JSON.stringify(profile)} />
    <input type="hidden" name="expected" value={updatedAt} />
    <input type="hidden" name="request_id" value={requestId} />

    {suggestions.length > 0 && <section className="panel section-pad profile-suggestions" aria-label="Sugjerime nga burimet">
      <p><b>Nga burimet e biznesit</b> · shiko dhe përdor nëse janë të sakta; ruhen vetëm me Ruaj.</p>
      {suggestions.map(suggestion => <div key={suggestion.field} className="profile-suggestion">
        <span>{suggestion.field === "website" ? "Website-i" : "Instagram-i"}: <b>{suggestion.value}</b> <small className="muted-copy">({suggestion.source})</small></span>
        <button type="button" className="btn btn-ghost" onClick={() => suggestion.field === "website" ? set("contacts", { website: suggestion.value })
          : set("contacts", { socials: [...socials, { network: "instagram", url: suggestion.value }] })}>Përdor</button>
      </div>)}
    </section>}

    <section className="panel section-pad profile-group" id="profile-identity" aria-labelledby="profile-identity-title">
      <h2 id="profile-identity-title">Identiteti</h2>
      <p className="muted-copy">Emri dhe logoja ndryshohen te <a className="inline-link" href={settingsHref}>Cilësimet e biznesit</a>.</p>
      {field("identity", "description", "Përshkrimi", "Shto përshkrimin", profile.identity?.description, props => area(props, 4), "Çfarë është biznesi, me pak fjalë, siç ia thotë Agjenti klientit.")}
      {field("identity", "activity", "Veprimtaria", "Shto veprimtarinë", profile.identity?.activity, props => text(props, "text", "p.sh. Dyqan lodrash prej druri"))}
    </section>

    <section className="panel section-pad profile-group" id="profile-contacts" aria-labelledby="profile-contacts-title">
      <h2 id="profile-contacts-title">Kontaktet publike</h2>
      <p className="muted-copy">Ato që Agjenti u jep klientëve. Kontaktet e llogarisë, faturimit dhe njoftimeve mbeten te Cilësimet.</p>
      {field("contacts", "phone", "Telefoni", "Shto telefonin", profile.contacts?.phone, props => text(props, "tel", "+355 69 …"))}
      {field("contacts", "email", "Email-i", "Shto email-in", profile.contacts?.email, props => text(props, "email"))}
      {field("contacts", "website", "Website-i", "Shto website-in", profile.contacts?.website, props => text(props, "url", "https://"))}
      <div className="form-label">Rrjetet sociale
        {socials.map((social, index) => <div key={index} className="profile-row">
          <select className="field" aria-label="Rrjeti" value={social.network} onChange={event => set("contacts", { socials: socials.map((item, i) => i === index ? { ...item, network: event.target.value as Social["network"] } : item) })}>
            {socialNetworks.map(network => <option key={network} value={network}>{networkLabels[network]}</option>)}</select>
          <input className="field" aria-label="Lidhja" value={social.url} placeholder="https://" onChange={event => set("contacts", { socials: socials.map((item, i) => i === index ? { ...item, url: event.target.value } : item) })} />
          <button type="button" className="btn btn-ghost" onClick={() => set("contacts", { socials: socials.filter((_, i) => i !== index) })}>Hiq</button>
        </div>)}
        {socials.length < 8 && <button type="button" className="profile-add" onClick={() => set("contacts", { socials: [...socials, { network: "instagram", url: "" }] })}>＋ Shto një rrjet social</button>}
      </div>
    </section>

    <section className="panel section-pad profile-group" id="profile-location" aria-labelledby="profile-location-title">
      <h2 id="profile-location-title">Vendndodhja</h2>
      {field("location", "address", "Adresa", "Shto adresën", profile.location?.address, props => text(props, "text", "Rruga, numri, qyteti"))}
      {field("location", "maps_url", "Lidhja Google Maps", "Shto lidhjen Google Maps", profile.location?.maps_url, props => text(props, "url", "https://maps.google.com/…"))}
      {profile.location?.lat !== undefined || shown.has("point") ? <div className="profile-row">
        <label className="form-label">Gjerësia<input className="field" inputMode="decimal" value={profile.location?.lat ?? ""} onChange={event => set("location", { lat: event.target.value === "" ? undefined : event.target.value as unknown as number })} /></label>
        <label className="form-label">Gjatësia<input className="field" inputMode="decimal" value={profile.location?.lng ?? ""} onChange={event => set("location", { lng: event.target.value === "" ? undefined : event.target.value as unknown as number })} /></label>
      </div> : <button type="button" className="profile-add" onClick={() => setShown(current => new Set(current).add("point"))}>＋ Shto pikën në hartë</button>}
      {field("location", "directions", "Udhëzimet për mbërritjen", "Shto udhëzimet për mbërritjen", profile.location?.directions, props => area(props, 2), "p.sh. Hyrja nga rruga e pasme; parkim falas.")}
    </section>

    <section className="panel section-pad profile-group" id="profile-hours" aria-labelledby="profile-hours-title">
      <h2 id="profile-hours-title">Orari i hapjes</h2>
      <p className="muted-copy">Kur është i hapur biznesi. Orari i rezervimeve është veçmas, te Kalendari. Një ditë “Pa caktuar” Agjenti e thotë si të panjohur, jo si mbyllur.{timezone ? ` Zona kohore: ${timezone}.` : ""}</p>
      <div className="profile-hours">
        {weekOrder.map(day => {
          const state = dayState(day);
          return <div key={day} className="profile-day">
            <span>{weekdays[day]}</span>
            <select className="field" aria-label={`${weekdays[day]}: gjendja`} value={state} onChange={event => setDay(day, event.target.value)}>
              <option value="unknown">Pa caktuar</option><option value="open">Hapur</option><option value="closed">Pushim</option>
            </select>
            <div className="profile-intervals">
              {weekly.map((item, index) => item.day !== day ? null : <span key={index} className="profile-interval">
                <input className="field" type="time" aria-label={`${weekdays[day]}: hapet`} value={item.open} onChange={event => setInterval(index, { open: event.target.value })} />–
                <input className="field" type="time" aria-label={`${weekdays[day]}: mbyllet`} value={item.close} onChange={event => setInterval(index, { close: event.target.value })} />
                {weekly.filter(other => other.day === day).length > 1 && <button type="button" className="btn btn-ghost" onClick={() => setHours({ weekly: weekly.filter((_, i) => i !== index) })}>Hiq</button>}
              </span>)}
              {state === "open" && <button type="button" className="profile-add" onClick={() => setHours({ weekly: [...weekly, { day, open: "14:00", close: "18:00" }] })}>＋ interval</button>}
            </div>
          </div>;
        })}
      </div>
      <div className="form-label">Përjashtime (festa, ditë të veçanta)
        {exceptions.map((item, index) => <div key={index} className="profile-row">
          <input className="field" type="date" aria-label="Data" value={item.date} onChange={event => setHours({ exceptions: exceptions.map((other, i) => i === index ? { ...other, date: event.target.value } : other) })} />
          <select className="field" aria-label="Gjendja" value={item.closed ? "closed" : "open"} onChange={event => setHours({ exceptions: exceptions.map((other, i) => i === index ? (event.target.value === "closed" ? { date: other.date, closed: true, note: other.note } : { ...other, closed: false, open: other.open ?? "09:00", close: other.close ?? "13:00" }) : other) })}>
            <option value="closed">Mbyllur</option><option value="open">Orar i veçantë</option></select>
          {!item.closed && <><input className="field" type="time" aria-label="Hapet" value={item.open ?? ""} onChange={event => setHours({ exceptions: exceptions.map((other, i) => i === index ? { ...other, open: event.target.value } : other) })} />
            <input className="field" type="time" aria-label="Mbyllet" value={item.close ?? ""} onChange={event => setHours({ exceptions: exceptions.map((other, i) => i === index ? { ...other, close: event.target.value } : other) })} /></>}
          <button type="button" className="btn btn-ghost" onClick={() => setHours({ exceptions: exceptions.filter((_, i) => i !== index) })}>Hiq</button>
        </div>)}
        <button type="button" className="profile-add" onClick={() => setHours({ exceptions: [...exceptions, { date: "", closed: true } as HoursException] })}>＋ Shto një përjashtim</button>
      </div>
      {field("hours", "note", "Shënim për orarin", "Shto një shënim për orarin", profile.hours?.note, props => text(props, "text", "p.sh. Në gusht mbyllur të shtunën"))}
    </section>

    <div className="profile-save">
      <button className="btn btn-primary" type="submit" disabled={!dirty}>Ruaj</button>
      <p className="muted-copy">{dirty ? "Ke ndryshime të paruajtura. Ruaj i zbaton menjëherë dhe krijon një version që mund ta rikthesh." : "Agjenti përdor këtë profil në përgjigjet e reja."}</p>
    </div>
  </ActionForm>;
}
