import { graphVersion } from "./oauth";

export type InstagramBusinessProfile = {
  name?: string; username?: string; biography?: string; website?: string; profile_picture_url?: string;
};
const fields = ["name", "username", "biography", "website", "profile_picture_url"] as const;
function publicLink(raw: unknown) {
  if (typeof raw !== "string" || !raw.trim() || (/^[a-z][a-z0-9+.-]*:/i.test(raw.trim()) && !/^https?:\/\//i.test(raw.trim()))) return undefined;
  try {
    const url = new URL(raw.trim().match(/^https?:\/\//i) ? raw.trim() : `https://${raw.trim()}`);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.href.length <= 2000 ? url.href : undefined;
  } catch { return undefined; }
}
export function cleanBusinessProfile(raw: Record<string, unknown>): InstagramBusinessProfile {
  const result: InstagramBusinessProfile = {};
  for (const field of fields) {
    const value = field === "website" || field === "profile_picture_url" ? publicLink(raw[field]) : typeof raw[field] === "string" ? raw[field].trim().slice(0, 2000) : undefined;
    if (value) result[field] = value;
  }
  // Some profiles put their only website inside the biography.
  if (!result.website && result.biography) result.website = publicLink(result.biography.match(/https?:\/\/[^\s<>]+/i)?.[0]?.replace(/[),.;]+$/, ""));
  return result;
}
export async function fetchInstagramBusinessProfile(token: string, accountId: string) {
  async function read(requested: readonly string[]) {
    try {
      const url = new URL(`https://graph.instagram.com/${graphVersion()}/${encodeURIComponent(accountId)}`);
      url.searchParams.set("fields", requested.join(","));
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000), cache: "no-store" });
      if (!response.ok) return {};
      const raw = await response.json();
      return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    } catch { return {}; } // Optional metadata; never log credentials/provider errors.
  }
  let raw = await read(fields);
  const missing = fields.filter(field => typeof raw[field] !== "string");
  if (missing.length) {
    // One rejected optional field must not discard other available metadata.
    const partial = await Promise.all(missing.map(field => read([field])));
    partial.forEach((value, index) => { const field = missing[index]; if (typeof value[field] === "string") raw = { ...raw, [field]: value[field] }; });
  }
  const data = cleanBusinessProfile(raw);
  return { data, note: data.biography ? "U lexua edhe përshkrimi i profilit." : "Bio-ja nuk u kthye nga Instagram API; analiza përdor informacionin e disponueshëm." };
}
