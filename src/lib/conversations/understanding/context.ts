import { withSemanticSelections } from "./selection";
import { AsyncLocalStorage } from "node:async_hooks";
import { unknownUnderstanding, type MessageUnderstanding } from "./contract";
/** Request-local semantic evidence, analogous to execution-context. Never a
 * global cache, client checkpoint, persisted state or authorization source. */
const context = new AsyncLocalStorage<{ message: string; meaning: MessageUnderstanding }>();
const normalize = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
export function messageUnderstanding(message: string): MessageUnderstanding {
  const current = context.getStore();
  return current && normalize(current.message) === normalize(message) ? current.meaning : unknownUnderstanding;
}
export function hasUnderstandingContext() { return Boolean(context.getStore()); }
export function hasMessageUnderstanding(message: string) { return Boolean(context.getStore() && normalize(context.getStore()!.message) === normalize(message)); }
export function withMessageUnderstanding<T>(message: string, meaning: MessageUnderstanding, run: () => T): T {
  return withSemanticSelections(() => context.run({ message, meaning }, run));
}
