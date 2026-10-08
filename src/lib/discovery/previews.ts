export type ScanPreview = { id: string; title: string; excerpt: string; imageUrl: string | null };

// Expose a bounded visual preview, never the raw capture or connection data.
export function discoveryPreviews(source: string, checkpoint: unknown): ScanPreview[] {
  if (!checkpoint || typeof checkpoint !== "object") return [];
  const data = checkpoint as Record<string, unknown>;
  const items = source === "instagram" ? data.images : data.previews;
  if (!Array.isArray(items)) return [];
  return items.slice(0, source === "instagram" ? 25 : 8).flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const title = source === "instagram" ? `Postim ${index + 1}` : text(row.title, 120);
    let imageUrl: string | null = null;
    if (source === "instagram" && typeof row.url === "string") {
      try {
        const url = new URL(row.url);
        if (url.protocol === "https:" && !url.username && !url.password &&
          /(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname) &&
          ![...url.searchParams.keys()].some(key => /access_token|authorization|api_key/i.test(key))) imageUrl = url.href;
      } catch { /* An unavailable image still has its caption. */ }
    }
    const excerpt = text(source === "instagram" ? row.caption : row.excerpt, 180);
    if (!imageUrl && !excerpt && !title) return [];
    return [{ id: `${source}-${index}`, title, excerpt, imageUrl }];
  });
}

function text(value: unknown, limit: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}
