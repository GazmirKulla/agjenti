import { randomUUID } from "node:crypto";
import { renderProductReferences, type ReferenceProduct } from "@/lib/products/entity-bridge";
import type { CatalogPresentation, Snapshot } from "./contracts";
import { digest } from "./definition";

export function renderCatalogSlots(reply: string, products: readonly ReferenceProduct[], services: readonly ReferenceProduct[]) {
  const product = renderProductReferences(reply, products, "product");
  const service = renderProductReferences(product.reply, services, "service");
  const mixed = product.presentedProducts.length > 0 && service.presentedProducts.length > 0;
  return {
    reply: service.reply,
    presented: mixed || !product.presentedProducts.length && !service.presentedProducts.length ? undefined : {
      kind: (product.presentedProducts.length ? "product" : "service") as CatalogPresentation["kind"],
      items: product.presentedProducts.length ? product.presentedProducts : service.presentedProducts,
    },
  };
}

export function catalogPresentationFromReply(
  businessId: string, reply: string, presented: { kind: CatalogPresentation["kind"]; items: readonly ReferenceProduct[] } | undefined, now: number,
): CatalogPresentation | undefined {
  if (!presented?.items.length || presented.items.length > 10) return;
  return {
    businessId, kind: presented.kind, sourceTurn: randomUUID(), expiresAt: now + 15 * 60_000, replyDigest: digest(reply),
    entities: presented.items.map((item, index) => ({ id: item.id, displayOrder: index + 1 })),
  };
}

/** Live ordinals require a confirmed delivery of the same reply; names are never the authority. */
export function visibleCatalogPresentation(state: Snapshot, now: number, deliveredReply?: string | null) {
  const presentation = state.catalogPresentation;
  if (!presentation || presentation.businessId !== state.businessId || !Number.isFinite(presentation.expiresAt) || presentation.expiresAt <= now) return;
  if (!Array.isArray(presentation.entities) || !presentation.entities.length || presentation.entities.length > 10
    || presentation.entities.some((entity, index) => entity.displayOrder !== index + 1 || typeof entity.id !== "string")
    || new Set(presentation.entities.map(entity => entity.id)).size !== presentation.entities.length) return;
  const last = [...(state.history ?? [])].reverse().find(message => message.role === "assistant");
  if (!last || digest(last.content) !== presentation.replyDigest) return;
  if (state.mode === "live" && (!deliveredReply || digest(deliveredReply) !== presentation.replyDigest)) return;
  return presentation;
}
