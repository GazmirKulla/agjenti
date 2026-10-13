import { createHash } from "node:crypto";
import type { VisualGraph } from "./types";

/** Exact normalized snapshot, including prompts, bindings and array order. Never expose its input. */
export function visualGraphHash(graph: VisualGraph): string {
  return createHash("sha256").update(JSON.stringify(graph)).digest("hex");
}
