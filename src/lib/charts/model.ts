/** Shared presentation contract. Values are supplied by authorized server readers, never by the model. */
export type ChartData = {
  title: string;
  kind: "line" | "bar" | "stacked";
  categories: { key: string; label: string }[];
  series: { key: string; label: string; tone?: "accent" | "muted" | "success" | "danger" | "warning"; values: (number | null)[] }[];
  note?: string;
  timezone?: string;
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 200): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
/** Bounds apply equally to stored chat blocks and page charts. Null means unavailable, never zero. */
export function readChart(value: unknown): ChartData | null {
  if (!record(value) || !text(value.title) || !["line", "bar", "stacked"].includes(String(value.kind))
    || !Array.isArray(value.categories) || value.categories.length > 366 || !Array.isArray(value.series)
    || !value.series.length || value.series.length > 6 || value.note !== undefined && !text(value.note, 600)
    || value.timezone !== undefined && !text(value.timezone, 100)) return null;
  const categories = value.categories;
  if (!categories.every(c => record(c) && text(c.key, 100) && text(c.label, 100))
    || new Set(categories.map(c => c.key)).size !== categories.length) return null;
  if (!value.series.every(s => record(s) && text(s.key, 100) && text(s.label, 100) && Array.isArray(s.values)
    && (s.tone === undefined || ["accent", "muted", "success", "danger", "warning"].includes(String(s.tone)))
    && s.values.length === categories.length && s.values.every(n => n === null || typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER))
    || new Set(value.series.map(s => s.key)).size !== value.series.length) return null;
  return { title: value.title, kind: value.kind as ChartData["kind"],
    categories: categories.map(c => ({ key: c.key, label: c.label })),
    series: value.series.map(s => ({ key: s.key, label: s.label, ...(s.tone ? { tone: s.tone } : {}), values: [...s.values] })),
    ...(value.note ? { note: value.note as string } : {}), ...(value.timezone ? { timezone: value.timezone as string } : {}) };
}
export function chartText(data: ChartData) {
  return [data.title, data.timezone, ...data.categories.map((c, i) => `${c.label}: ${data.series.map(s => `${s.label} ${s.values[i] ?? "e padisponueshme"}`).join(" · ")}`), data.note].filter(Boolean).join("\n");
}
