/**
 * Structured parts of an Assistant message: cards and tables the owner reads under the text.
 *
 * The server builds every block from data it read itself (a briefing, a catalog search); the model
 * never writes a block's numbers, names or prices. Blocks are stored with the message, so they
 * survive a refresh, and are validated again before they are shown. A block that does not pass
 * is left out and the message text remains. Display only: a block never authorizes an action.
 */
export type MetricItem = { label: string; value: number | null; note?: string; href?: string };
export type MetricsBlock = { type: "metrics"; version: 1; title: string; items: MetricItem[]; note?: string };

export type TableColumn = { key: string; label: string; numeric?: boolean };
export type TableRow = { cells: Record<string, string>; ref?: { kind: "product"; id: string } };
export type TableBlock = {
  type: "table"; version: 1; title: string; columns: TableColumn[]; rows: TableRow[];
  /** Exact count of matches when the server knows it; rows may be fewer. */
  total: number | null;
  /** The rows are not the complete answer (scan limit, size budget or more pages). */
  partial: boolean;
  note?: string;
};
export type MessageBlock = MetricsBlock | TableBlock;
export type BlockType = MessageBlock["type"];

export const MAX_BLOCKS = 4;
export const MAX_METRICS = 8;
export const MAX_COLUMNS = 6;
export const MAX_TABLE_ROWS = 60;
/** Compact JSON budget; PostgreSQL also bounds its expanded JSONB text representation. */
export const MAX_BLOCKS_BYTES = 65536;
const TEXT = 200, CELL = 300, NOTE = 400;

type Raw = Record<string, unknown>;
const record = (value: unknown): value is Raw => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const optionalText = (value: unknown, max: number) => value === undefined || text(value, max);
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
/** Links stay inside this business's dashboard; nothing external or scriptable. */
const dashboardHref = (value: unknown) => value === undefined || typeof value === "string" && /^\/b\/[a-z0-9-]+(\/[\w\-./?=&]*)?$/i.test(value) && !value.includes("..");
const columnKey = (value: unknown) => typeof value === "string" && /^[a-z][a-z0-9_]{0,40}$/i.test(value);

function metrics(raw: Raw): MetricsBlock | null {
  if (raw.version !== 1 || !text(raw.title, TEXT) || !optionalText(raw.note, NOTE) || !Array.isArray(raw.items)) return null;
  if (!raw.items.length || raw.items.length > MAX_METRICS) return null;
  const items = raw.items.every(item => record(item) && text(item.label, TEXT) && (item.value === null || count(item.value))
    && optionalText(item.note, NOTE) && dashboardHref(item.href));
  if (!items) return null;
  return { type: "metrics", version: 1, title: raw.title as string, items: (raw.items as Raw[]).map(item => ({
    label: item.label as string, value: item.value as number | null,
    ...(item.note !== undefined ? { note: item.note as string } : {}), ...(item.href !== undefined ? { href: item.href as string } : {}),
  })), ...(raw.note !== undefined ? { note: raw.note as string } : {}) };
}

function table(raw: Raw): TableBlock | null {
  if (raw.version !== 1 || !text(raw.title, TEXT) || !optionalText(raw.note, NOTE) || typeof raw.partial !== "boolean"
    || !(raw.total === null || count(raw.total)) || !Array.isArray(raw.columns) || !Array.isArray(raw.rows)) return null;
  const columns = raw.columns;
  if (!columns.length || columns.length > MAX_COLUMNS || (!raw.rows.length && raw.total !== 0) || raw.rows.length > MAX_TABLE_ROWS
    || (typeof raw.total === "number" && raw.total < raw.rows.length)) return null;
  if (!columns.every(c => record(c) && columnKey(c.key) && text(c.label, TEXT) && (c.numeric === undefined || typeof c.numeric === "boolean"))) return null;
  const keys = columns.map(c => (c as Raw).key as string);
  if (new Set(keys).size !== keys.length) return null;
  const rows = raw.rows.every(row => record(row) && record(row.cells)
    && Object.keys(row.cells).length === keys.length
    && Object.keys(row.cells).every(key => keys.includes(key))
    && Object.values(row.cells).every(value => typeof value === "string" && value.length <= CELL)
    && (row.ref === undefined || record(row.ref) && row.ref.kind === "product" && uuid(row.ref.id)));
  if (!rows) return null;
  return { type: "table", version: 1, title: raw.title as string, total: raw.total as number | null, partial: raw.partial,
    columns: (columns as Raw[]).map(c => ({ key: c.key as string, label: c.label as string, ...(c.numeric ? { numeric: true } : {}) })),
    rows: (raw.rows as Raw[]).map(row => ({ cells: { ...(row.cells as Record<string, string>) },
      ...(row.ref ? { ref: { kind: "product" as const, id: (row.ref as Raw).id as string } } : {}) })),
    ...(raw.note !== undefined ? { note: raw.note as string } : {}) };
}

const readers: { [K in BlockType]: (raw: Raw) => Extract<MessageBlock, { type: K }> | null } = { metrics, table };

/** The valid blocks of a stored or received value, in order. Anything else is left out. */
export function parseBlocks(raw: unknown): MessageBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_BLOCKS).flatMap(item => {
    if (!record(item) || typeof item.type !== "string" || !Object.hasOwn(readers, item.type)) return [];
    const block = readers[item.type as BlockType](item);
    return block ? [block] : [];
  });
}

/** Blocks to store with a message: only valid ones, and none at all past the size bound. */
export function storableBlocks(raw: unknown): MessageBlock[] {
  const blocks = parseBlocks(raw);
  return blocks.length && new TextEncoder().encode(JSON.stringify(blocks)).length <= MAX_BLOCKS_BYTES ? blocks : [];
}

/** The block as plain lines: what a client without the component shows, and what the model reads in history. */
export function blockText(block: MessageBlock): string {
  if (block.type === "metrics")
    return [block.title, ...block.items.map(item => `${item.label}: ${item.value ?? item.note ?? "—"}`), block.note].filter(Boolean).join("\n");
  const shown = block.total === null ? "" : block.total === block.rows.length ? ` (${block.total})` : ` (${block.rows.length} nga ${block.total})`;
  return [`${block.title}${shown}`, ...(block.rows.length ? [block.columns.map(c => c.label).join(" · ")] : []),
    ...block.rows.map(row => block.columns.map(c => row.cells[c.key] || "—").join(" · ")),
    block.note].filter(Boolean).join("\n");
}

/** Keep a bounded text rendering for history, copying, and clients without block support. */
function textAppendix(blocks: MessageBlock[]) {
  const text = blocks.map(blockText).join("\n\n");
  if (!text) return "";
  return "\n\n" + (text.length <= 8000 ? text : text.slice(0, 7999) + "…");
}

export function blockReply(summary: string, raw: unknown) {
  const blocks = storableBlocks(raw);
  const appendix = textAppendix(blocks);
  return { message: summary.slice(0, 12000 - appendix.length) + appendix, blocks };
}

/** Hide only the exact text already displayed by the validated cards or table. */
export function blockCaption(content: string, blocks: MessageBlock[]) {
  const appendix = textAppendix(blocks);
  return appendix && content.endsWith(appendix) ? content.slice(0, -appendix.length) : content;
}
