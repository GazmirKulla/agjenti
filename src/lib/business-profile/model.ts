/**
 * The business's public profile (businesses.public_profile): identity, public contacts, location and opening hours.
 * One source: the owner edits it in Agjenti → Biznesi, the customer agent reads it from the same column. An absent
 * field is unknown: it is never shown or told as closed or unavailable. Opening hours are not booking availability
 * (that stays in the calendar), and public contacts are not the account's, billing's or notifications' contacts.
 */
export type Social = { network: "instagram" | "facebook" | "tiktok" | "whatsapp" | "other"; url: string };
export type Interval = { day: number; open: string; close: string };
export type HoursException = { date: string; closed: boolean; open?: string; close?: string; note?: string };
export type BusinessProfile = {
  version: 1;
  identity?: { description?: string; activity?: string };
  contacts?: { phone?: string; email?: string; website?: string; socials?: Social[] };
  location?: { address?: string; lat?: number; lng?: number; maps_url?: string; directions?: string };
  hours?: { weekly?: Interval[]; closed_days?: number[]; exceptions?: HoursException[]; note?: string };
};
export const emptyProfile: BusinessProfile = { version: 1 };
export const weekdays = ["E diel", "E hënë", "E martë", "E mërkurë", "E enjte", "E premte", "E shtunë"];
export const socialNetworks: Social["network"][] = ["instagram", "facebook", "tiktok", "whatsapp", "other"];

export class ProfileError extends Error {}
const time = /^([01]\d|2[0-3]):[0-5]\d$/;
const dateFormat = /^\d{4}-\d{2}-\d{2}$/;
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value: unknown, max: number, label: string) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ProfileError(`${label} nuk është e vlefshme.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new ProfileError(`${label} është shumë e gjatë (deri në ${max} karaktere).`);
  return trimmed || undefined;
}
function url(value: unknown, label: string) {
  const raw = text(value, 500, label);
  if (!raw) return undefined;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withScheme);
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname.includes(".")) throw new Error();
    return parsed.toString();
  } catch { throw new ProfileError(`${label} nuk është një adresë e vlefshme interneti.`); }
}
function coordinate(value: unknown, min: number, max: number, label: string) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(number) || number < min || number > max) throw new ProfileError(`${label} nuk është e vlefshme.`);
  return Math.round(number * 1e6) / 1e6;
}
const prune = <T extends Record<string, unknown>>(value: T): T | undefined => {
  const kept = Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && !(Array.isArray(item) && !item.length)));
  return Object.keys(kept).length ? kept as T : undefined;
};

/** Checks and normalizes a whole profile; empty fields are dropped, never stored as "closed". */
export function parseProfile(raw: unknown): BusinessProfile {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, Record<string, unknown> | undefined> : {};
  const identity = source.identity ?? {}, contacts = source.contacts ?? {}, location = source.location ?? {}, hours = source.hours ?? {};
  const phone = text(contacts.phone, 40, "Telefoni");
  if (phone && !/^[+\d][\d\s()./-]{4,}$/.test(phone)) throw new ProfileError("Telefoni nuk është i vlefshëm.");
  const mail = text(contacts.email, 200, "Email-i");
  if (mail && !email.test(mail)) throw new ProfileError("Email-i nuk është i vlefshëm.");
  const socials = Array.isArray(contacts.socials) ? contacts.socials : [];
  if (socials.length > 8) throw new ProfileError("Deri në 8 rrjete sociale.");
  const weekly = Array.isArray(hours.weekly) ? hours.weekly : [];
  if (weekly.length > 28) throw new ProfileError("Shumë intervale orari.");
  const intervals = weekly.map((item: Partial<Interval>) => {
    if (!Number.isInteger(item?.day) || item.day! < 0 || item.day! > 6 || !time.test(String(item.open)) || !time.test(String(item.close)))
      throw new ProfileError("Çdo interval orari ka ditën, orën e hapjes dhe të mbylljes (HH:MM).");
    if (String(item.open) === String(item.close)) throw new ProfileError("Ora e hapjes dhe e mbylljes nuk mund të jenë të njëjta.");
    return { day: item.day!, open: String(item.open), close: String(item.close) };
  }).sort((a, b) => a.day - b.day || a.open.localeCompare(b.open));
  const closed = [...new Set((Array.isArray(hours.closed_days) ? hours.closed_days : []).map(Number))].sort();
  if (closed.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new ProfileError("Dita e pushimit nuk është e vlefshme.");
  if (closed.some(day => intervals.some(interval => interval.day === day))) throw new ProfileError("Një ditë nuk mund të jetë njëkohësisht e hapur dhe ditë pushimi.");
  const exceptions = (Array.isArray(hours.exceptions) ? hours.exceptions : []).map((item: Partial<HoursException>) => {
    if (!dateFormat.test(String(item?.date)) || !Number.isFinite(Date.parse(String(item.date)))) throw new ProfileError("Data e përjashtimit nuk është e vlefshme.");
    if (!item.closed && (!time.test(String(item.open)) || !time.test(String(item.close)))) throw new ProfileError("Një përjashtim i hapur ka orën e hapjes dhe të mbylljes.");
    return prune({ date: String(item.date), closed: Boolean(item.closed), ...(item.closed ? {} : { open: String(item.open), close: String(item.close) }), note: text(item.note, 200, "Shënimi") }) as HoursException;
  }).sort((a, b) => a.date.localeCompare(b.date));
  if (exceptions.length > 60) throw new ProfileError("Deri në 60 përjashtime.");
  const lat = coordinate(location.lat, -90, 90, "Gjerësia gjeografike"), lng = coordinate(location.lng, -180, 180, "Gjatësia gjeografike");
  if ((lat === undefined) !== (lng === undefined)) throw new ProfileError("Pika në hartë ka gjerësinë dhe gjatësinë bashkë.");
  const sections = {
    identity: prune({ description: text(identity.description, 2000, "Përshkrimi"), activity: text(identity.activity, 300, "Veprimtaria") }),
    contacts: prune({ phone, email: mail, website: url(contacts.website, "Website-i"), socials: socials.map((item: Partial<Social>) => {
      if (!socialNetworks.includes(item?.network as Social["network"])) throw new ProfileError("Rrjeti social nuk është i njohur.");
      return { network: item.network as Social["network"], url: url(item.url, "Lidhja e rrjetit social") };
    }).filter((item): item is Social => Boolean(item.url)) }),
    location: prune({ address: text(location.address, 500, "Adresa"), lat, lng, maps_url: url(location.maps_url, "Lidhja Google Maps"),
      directions: text(location.directions, 1000, "Udhëzimet për mbërritjen") }),
    hours: prune({ weekly: intervals, closed_days: closed, exceptions, note: text(hours.note, 300, "Shënimi për orarin") }),
  };
  return { version: 1, ...Object.fromEntries(Object.entries(sections).filter(([, value]) => value)) } as BusinessProfile;
}

/** The stored profile, tolerating an older or partial shape without inventing values. */
export function readProfile(raw: unknown): BusinessProfile {
  try { return parseProfile(raw); } catch { return { ...emptyProfile }; }
}

export type ProfileField = { key: string; section: "identity" | "contacts" | "location" | "hours"; label: string; action: string };
export const profileFields: ProfileField[] = [
  { key: "description", section: "identity", label: "Përshkrimi", action: "Shto përshkrimin" },
  { key: "activity", section: "identity", label: "Veprimtaria", action: "Shto veprimtarinë" },
  { key: "phone", section: "contacts", label: "Telefoni", action: "Shto telefonin" },
  { key: "email", section: "contacts", label: "Email-i", action: "Shto email-in" },
  { key: "website", section: "contacts", label: "Website-i", action: "Shto website-in" },
  { key: "address", section: "location", label: "Adresa", action: "Shto adresën" },
  { key: "hours", section: "hours", label: "Orari", action: "Shto orarin" },
];
/** What the profile does not say yet: offered as actions, never as "closed". */
export function missingFields(profile: BusinessProfile) {
  const has: Record<string, boolean> = {
    description: Boolean(profile.identity?.description), activity: Boolean(profile.identity?.activity), phone: Boolean(profile.contacts?.phone),
    email: Boolean(profile.contacts?.email), website: Boolean(profile.contacts?.website), address: Boolean(profile.location?.address),
    hours: Boolean(profile.hours?.weekly?.length || profile.hours?.closed_days?.length),
  };
  return profileFields.filter(field => !has[field.key]);
}

/** The sections the profile states, named for the owner (what the agent could read). */
export function statedSections(profile: BusinessProfile) {
  return (["identity", "contacts", "location", "hours"] as const).filter(section => profile[section] && Object.keys(profile[section]!).length);
}
export const sectionLabels = { identity: "Identiteti", contacts: "Kontaktet", location: "Vendndodhja", hours: "Orari" } as const;

/** The profile as the customer agent reads it: only what is stated, with the meaning of a missing day spelled out. */
export function agentProfileContext(profile: BusinessProfile, name: string, timezone: string | null) {
  const sections = statedSections(profile);
  if (!sections.length) return undefined;
  return { name, ...(timezone ? { timezone } : {}), ...Object.fromEntries(sections.map(section => [section, profile[section]])),
    ...(profile.hours ? { hoursMeaning: "weekly: open intervals (day 0 = Sunday); closed_days: days closed; a day in neither is not stated, so say it is unknown and suggest contacting the business, never that it is closed. exceptions override the weekly hours on their date." } : {}) };
}

const show = (value: unknown) => value === undefined || value === null || value === "" ? "—" : typeof value === "string" ? value : JSON.stringify(value);
/** Hours in words, e.g. "E hënë 09:00–17:00 · E diel: pushim". */
export function hoursText(hours: BusinessProfile["hours"]) {
  if (!hours) return "—";
  const open = weekdays.map((name, day) => {
    const intervals = hours.weekly?.filter(item => item.day === day) ?? [];
    if (intervals.length) return `${name} ${intervals.map(item => `${item.open}–${item.close}`).join(", ")}`;
    return hours.closed_days?.includes(day) ? `${name}: pushim` : null;
  }).filter(Boolean);
  const exceptions = hours.exceptions?.map(item => `${item.date}: ${item.closed ? "mbyllur" : `${item.open}–${item.close}`}`) ?? [];
  return [...open, ...exceptions, hours.note].filter(Boolean).join(" · ") || "—";
}
/** Before → after per field, in the owner's words, for the confirmation and the history summary. */
export function profileChanges(before: BusinessProfile, after: BusinessProfile) {
  const rows: { label: string; before: string; after: string }[] = [];
  const add = (label: string, a: unknown, b: unknown) => { if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) rows.push({ label, before: show(a), after: show(b) }); };
  add("Profili · Përshkrimi", before.identity?.description, after.identity?.description);
  add("Profili · Veprimtaria", before.identity?.activity, after.identity?.activity);
  add("Profili · Telefoni", before.contacts?.phone, after.contacts?.phone);
  add("Profili · Email-i", before.contacts?.email, after.contacts?.email);
  add("Profili · Website-i", before.contacts?.website, after.contacts?.website);
  add("Profili · Rrjetet sociale", before.contacts?.socials?.map(item => item.url).join(", "), after.contacts?.socials?.map(item => item.url).join(", "));
  add("Profili · Adresa", before.location?.address, after.location?.address);
  add("Profili · Pika në hartë", before.location?.lat !== undefined ? `${before.location.lat}, ${before.location.lng}` : undefined, after.location?.lat !== undefined ? `${after.location.lat}, ${after.location.lng}` : undefined);
  add("Profili · Google Maps", before.location?.maps_url, after.location?.maps_url);
  add("Profili · Udhëzimet për mbërritjen", before.location?.directions, after.location?.directions);
  const hoursBefore = hoursText(before.hours), hoursAfter = hoursText(after.hours);
  if (hoursBefore !== hoursAfter) rows.push({ label: "Profili · Orari", before: hoursBefore, after: hoursAfter });
  return rows;
}
