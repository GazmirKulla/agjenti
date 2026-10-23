import { createHash, randomUUID } from "node:crypto";
import { foldText, type ConversationStatePayload } from "@/lib/workflows/engine";
import { matchingCatalogNames } from "./match-name";
import { validValue, type FieldType } from "@/lib/workflows/context";

export type ReferenceProduct = { id: string; name: string; sku?: string | null; price_amount?: number | null; currency?: string | null };
export type PresentedEntity = {
  id: string;
  kind: "product" | "service";
  displayOrder: number;
  sourceTurn: string;
  name: string;
  price: number | null;
  currency: string | null;
};
/** Conversation-level presentation evidence, not another selected-entity/fact store.
 * The order's product_id and visual binding remain the selection authorities.
 * Services are reserved in the contract; W3 only records/resolves products. */
export type EntityPresentation = {
  businessId: string;
  sourceTurn: string;
  expiresAt: number;
  replyHash: string;
  previewHash: string;
  entities: PresentedEntity[];
};
export const MAX_PRESENTED_ENTITIES = 10;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Only explicit catalog slots count as presentation evidence. Plain model text
 * is never parsed into selected IDs. Unknown/duplicate slots cannot add entities. */
export function renderProductReferences(text: string, catalog: readonly ReferenceProduct[]) {
  const products: ReferenceProduct[] = [];
  let repeated = false;
  const prose = foldText(text.replace(/\[\[product:[^\]\r\n]+\]\]/g, ""));
  const untrackedName = catalog.some(p => p.name.length >= 2 && new RegExp(`(?:^|[^a-z0-9])${foldText(p.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`).test(prose));
  const reply = text.replace(/\[\[product:([^\]\r\n]+)\]\]/g, (_slot, id: string) => {
    const product = catalog.find(p => p.id === id);
    if (!product) return "[produkt i paverifikuar]";
    if (!products.some(p => p.id === id)) {
      if (products.length === MAX_PRESENTED_ENTITIES) return "[produkt shtesë — kërko listë më të shkurtër]";
      products.push(product);
    } else repeated = true;
    return `${product.name}${product.price_amount != null && product.currency ? ` — ${product.price_amount} ${product.currency}` : ""}`;
  });
  // A mixed/repeated list has no trustworthy ordinal order. Keep the answer,
  // but require explicit customer names instead of inventing presentation evidence.
  return { reply, presentedProducts: untrackedName || repeated && products.length > 1 ? [] : products };
}

export function recordEntityPresentation(state: ConversationStatePayload, businessId: string, reply: string, products?: readonly ReferenceProduct[]) {
  if (!products?.length || products.length > MAX_PRESENTED_ENTITIES || products.some(p => !reply.includes(p.name))) return;
  const sourceTurn = randomUUID();
  state.entityPresentation = {
    businessId, sourceTurn, expiresAt: Date.now() + 15 * 60_000,
    replyHash: hash(reply), previewHash: hash(reply.slice(0, 1200)),
    entities: products.slice(0, MAX_PRESENTED_ENTITIES).map((p, index) => ({
      id: p.id, kind: "product", displayOrder: index + 1, sourceTurn, name: p.name,
      price: typeof p.price_amount === "number" && Number.isFinite(p.price_amount) ? p.price_amount : null,
      currency: p.currency?.trim().toUpperCase() || null,
    })),
  };
}

/** A visual path can compose several knowledge replies. Retain their real order,
 * never the metadata of only the last adapter. Ambiguous repeated lists fail closed. */
export function combineProductPresentations(reply: string, parts: { reply: string; presentedProducts?: readonly ReferenceProduct[] }[]) {
  const ordered = parts.filter(part => part.presentedProducts?.length && reply.includes(part.reply))
    .sort((a, b) => reply.indexOf(a.reply) - reply.indexOf(b.reply));
  const products = ordered.flatMap(part => part.presentedProducts ?? []);
  return new Set(products.map(p => p.id)).size === products.length && products.length <= MAX_PRESENTED_ENTITIES ? products : [];
}

/** Negated names are not positive choices. Unparseable corrections fail closed. */
export function positiveEntityText(message: string): { text: string; correction: boolean } {
  const text = foldText(message).trim();
  const negation = /^(?:jo|not|nuk dua|s'dua|s dua|i do not want)\s+/.test(text);
  if (!negation) return { text: message, correction: false };
  const rest = text.replace(/^(?:jo|not|nuk dua|s'dua|s dua|i do not want)\s+/, "");
  const choice = rest.match(/(?:[,;]|\b(?:por dua|por|but i want|but|i want|dua)\b)\s*(.+)$/);
  return { text: choice?.[1]?.replace(/^(?:dua|i want)\s+/, "") ?? "", correction: true };
}

function relativeReference(message: string): { kind: "ordinal"; index: number } | { kind: "cheapest" | "this" | "ambiguous" } | null {
  const text = foldText(message).replace(/[.!?]+$/g, "").trim();
  const cheapest = /\b(?:me i liri|me te lirin|me te lire|the cheapest|cheapest)\b/.test(text);
  const ordinals = [/\b(?:i pari|te parin|e para|e pare|the first|first one)\b/, /\b(?:i dyti|te dytin|e dyta|e dyte|the second|second one)\b/, /\b(?:i treti|te tretin|e treta|e trete|the third|third one)\b/];
  if (ordinals.filter(pattern => pattern.test(text)).length + Number(cheapest) > 1) return { kind: "ambiguous" };
  if (cheapest) return { kind: "cheapest" };
  const index = ordinals.findIndex(pattern => pattern.test(text));
  if (index >= 0) return { kind: "ordinal", index: index + 1 };
  const numbered = text.match(/^(?:(?:dua|zgjedh|i want)\s+)?(?:produktin?|numrin?|number|#)\s*(\d{1,2})$/);
  if (numbered) return { kind: "ordinal", index: Number(numbered[1]) };
  if (/^(?:dua ta (?:blej|marr|porosis)|e dua)$/.test(text)) return { kind: "this" };
  if (/^(?:(?:dua|zgjedh|e dua|me trego|i want|show me|buy|order)\s+)?(?:kete(?: produkt(?:in)?)?|ate(?: produkt(?:in)?)?|this one|this|it)(?:\s+(?:ta porosis|ta blej))?$/.test(text)) return { kind: "this" };
  return null;
}
export const isEntityReference = (message: string) => Boolean(relativeReference(message) || positiveEntityText(message).correction);

/** A typed literal or bare SKU can answer a pending field. Explicit entity
 * navigation still wins; free-text names retain the existing W3 disambiguation. */
export function isBareCollectionValue(message: string, fieldType: FieldType | undefined, catalog: readonly Pick<ReferenceProduct, "sku">[] = []) {
  if (!fieldType || isEntityReference(message)) return false;
  const text = message.trim();
  return fieldType !== "text" && fieldType !== "photo" && validValue(text, fieldType)
    || catalog.some(product => product.sku && foldText(product.sku) === foldText(text));
}

export type ProductResolution = { status: "none" } | { status: "selected"; product: ReferenceProduct; via: "name" | "ordinal" | "cheapest" | "this" | "correction" | "verified_id" }
  | { status: "clarify"; reason: string; reply: string };
const clarify = (reason: string, reply = "Cilin produkt dëshiron? Shkruaj emrin e plotë; zgjedhja e mëparshme nuk u ndryshua."): ProductResolution => ({ status: "clarify", reason, reply });

/** Pure resolver: catalog must be loaded server-side with tenant + active filters.
 * Price comparisons use current catalog values, never a model's price claim. */
export function resolveProductReference(args: {
  businessId: string; message: string; products: readonly ReferenceProduct[];
  state?: ConversationStatePayload | null; deliveredReply?: string | null; mode?: "test" | "production";
  verifiedId?: string;
  /** Server-derived pending field: bare SKU-shaped values belong to collection.
   * Explicit `sku ...`, named corrections and relative choices remain navigation. */
  collectingField?: FieldType;
}): ProductResolution {
  if (args.verifiedId) {
    const product = args.products.find(p => p.id === args.verifiedId);
    return product ? { status: "selected", product, via: "verified_id" } : clarify("unavailable", "Produkti nuk është më aktiv ose i disponueshëm në këtë biznes. Shkruaj një produkt tjetër.");
  }
  const positive = positiveEntityText(args.message);
  const relative = relativeReference(positive.text);
  if (isBareCollectionValue(args.message, args.collectingField, args.products)) return { status: "none" };
  if (relative?.kind === "ambiguous") return clarify("ambiguous_reference");
  if (!relative) {
    const text = foldText(positive.text).trim();
    const sku = args.products.filter(p => p.sku && (foldText(p.sku) === text || `sku ${foldText(p.sku)}` === text));
    const matches = sku.length ? sku : positive.text ? matchingCatalogNames([...args.products], positive.text) : [];
    if (matches.length > 1) return clarify("multiple_matches");
    if (matches.length === 1) return { status: "selected", product: matches[0], via: positive.correction ? "correction" : "name" };
    return positive.correction ? clarify("unknown_correction") : { status: "none" };
  }
  const presentation = args.state?.entityPresentation;
  const last = args.state?.recentMessages?.at(-1);
  // Legacy compatibility for a purchase continuation of the customer's own
  // immediately preceding exact named-product question (not assistant prose).
  if (!presentation && /^dua ta (?:blej|marr|porosis)[.!\s]*$/.test(foldText(args.message))
    && last?.role === "assistant" && (args.mode === "test" || args.deliveredReply?.slice(0, 1200) === last.content)) {
    const previous = args.state?.recentMessages?.at(-2);
    if (previous?.role === "user") {
      const named = args.products.filter(p => new RegExp(`(?:^|[^a-z0-9])${foldText(p.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`).test(foldText(previous.content)));
      if (named.length === 1) return { status: "selected", product: named[0], via: "name" };
    }
  }
  if (!presentation || presentation.businessId !== args.businessId || !Number.isFinite(presentation.expiresAt) || presentation.expiresAt <= Date.now()
    || last?.role !== "assistant" || hash(last.content) !== presentation.previewHash
    || args.mode !== "test" && (!args.deliveredReply || hash(args.deliveredReply) !== presentation.replyHash))
    return clarify("stale_reference", "Lista e mëparshme nuk është më një referencë e sigurt. Shkruaj emrin e produktit ose kërko një listë të re.");
  const entries = presentation.entities;
  if (!Array.isArray(entries) || !entries.length || entries.length > MAX_PRESENTED_ENTITIES
    || entries.some((p, i) => p.kind !== "product" || p.sourceTurn !== presentation.sourceTurn || p.displayOrder !== i + 1)
    || new Set(entries.map(p => p.id)).size !== entries.length) return clarify("invalid_presentation");
  const current = entries.map(entry => args.products.find(p => p.id === entry.id));
  let product: ReferenceProduct | undefined;
  if (relative.kind === "ordinal") product = current[relative.index - 1];
  if (relative.kind === "this") {
    if (entries.length !== 1) return clarify("ambiguous_reference");
    product = current[0];
  }
  if (relative.kind === "cheapest") {
    if (current.some(p => !p)) return clarify("unavailable");
    if (current.some(p => typeof p!.price_amount !== "number" || !Number.isFinite(p!.price_amount) || p!.price_amount! < 0 || !p!.currency?.trim()))
      return clarify("missing_price", "Nuk kam çmim dhe monedhë të verifikuar për të gjitha produktet e listës. Cilin produkt dëshiron me emër?");
    if (new Set(current.map(p => p!.currency!.trim().toUpperCase())).size !== 1) return clarify("mixed_currencies", "Produktet kanë monedha të ndryshme; nuk mund të përcaktoj më të lirin pa një kurs këmbimi. Cilin dëshiron?");
    if (current.some((p, i) => p!.price_amount !== entries[i].price || p!.currency!.trim().toUpperCase() !== entries[i].currency)) return clarify("price_changed", "Çmimet kanë ndryshuar nga lista e mëparshme. Kërko një listë të përditësuar ose zgjidh me emër.");
    const price = Math.min(...current.map(p => p!.price_amount!));
    const cheapest = current.filter(p => p!.price_amount === price);
    if (cheapest.length !== 1) return clarify("tied_prices", "Disa produkte kanë të njëjtin çmim më të ulët. Cilin dëshiron me emër?");
    product = cheapest[0];
  }
  return product ? { status: "selected", product, via: relative.kind } : clarify("unavailable", "Produkti i referuar nuk është më aktiv ose nuk gjendet në këtë listë. Shkruaj emrin e një produkti aktiv.");
}
