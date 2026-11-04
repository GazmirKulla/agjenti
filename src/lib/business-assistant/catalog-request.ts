import type { AssistantUIContext } from "./context";

/** Fast path for complete commands, not keyword matching or conversational consent.
 * Everything else still goes through the planner. This only prepares a review. */
export function readCatalogRemovalRequest(text: string, context?: AssistantUIContext, history: { role: "user" | "assistant"; content: string }[] = []): { scope: "all" | "listed" | "ids"; ids?: string[] } | undefined {
  const command = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[.!]+$/, "").replace(/\s+/g, " ");
  const match = /^(?:fshi|fshij|fshiji|fshije) (?:te gjitha produktet|produktet e listuara|te gjitha produktet e listuara|produktet e zgjedhura|te gjitha)$/.exec(command);
  if (!match) return undefined;
  // A short follow-up must have an explicit current catalog context.
  if (command.endsWith(" te gjitha")) {
    if (context?.page !== "products") return undefined;
    if (context.selectedEntityIds?.length) return { scope: "ids", ids: context.selectedEntityIds };
    // 'All' may refer to a subset discussed in chat. Only inherit a complete
    // owner command; an assistant's claim or a page alone is not a target set.
    const previous = history.findLast(message => message.role === "user");
    return previous ? readCatalogRemovalRequest(previous.content, context) : undefined;
  }
  if (command.endsWith("e zgjedhura")) {
    if (!context?.selectedEntityIds?.length) return undefined;
    return { scope: "ids" as const, ids: context.selectedEntityIds };
  }
  if (command.endsWith("e listuara")) {
    if (context?.page !== "products") return undefined;
    return { scope: "listed" as const };
  }
  return { scope: "all" as const };
}
