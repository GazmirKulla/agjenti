import { prompt } from "@/lib/ai/prompts/files";
import { AsyncLocalStorage } from "node:async_hooks";
import OpenAI from "@/lib/ai/openai";
import { modelFor } from "@/lib/agents/model";

/** Prompt text: prompts/agjenti-i-klienteve/njohja-e-produktit (identity) dhe zgjedhja-e-njohurive.md */
export const SEMANTIC_SELECTION_PROMPT = (kind: string) => prompt(kind === "identity" ? "agjenti-i-klienteve/njohja-e-produktit" : "agjenti-i-klienteve/zgjedhja-e-njohurive");

export type SemanticCandidate = { title: string; body?: string };
export type SemanticSelection = { index: number; score: number; evidence: string };
export class SelectionUnavailable extends Error {
  constructor() { super("Nuk u verifikua kuptimi i kërkesës. Progresi është ruajtur; provo përsëri."); }
}
const schema = { type: "object", additionalProperties: false, required: ["matches"], properties: {
  matches: { type: "array", items: { type: "object", additionalProperties: false, required: ["index", "score", "evidence"], properties: {
    index: { type: "integer" }, score: { type: "number" }, evidence: { type: "string" },
  } } },
} };

/** Candidate positions refer only to this server-provided read. Selection never
 * creates an ID, proves completeness or authorizes an effect. All batches must
 * succeed: an unread batch may contain another equally plausible identity. */
async function executeSelection(kind: "identity" | "relevance", entries: readonly SemanticCandidate[], message: string, deadline?: number): Promise<SemanticSelection[]> {
  if (!entries.length || !message.trim()) return [];
  if (!process.env.OPENAI_API_KEY?.trim()) throw new SelectionUnavailable();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20000, maxRetries: 0 });
  const matches: SemanticSelection[] = [];
  try {
    const readBatch = async (start: number) => {
      if (deadline !== undefined && Date.now() >= deadline) throw new SelectionUnavailable();
      const batch = entries.slice(start, start + 100);
      const response = await client.responses.create({
        model: modelFor("customer"), store: false, max_output_tokens: 4000,
        instructions: SEMANTIC_SELECTION_PROMPT(kind),
        input: JSON.stringify({ message, candidates: batch.map((entry, index) => ({ index, title: entry.title.slice(0, 1000), ...(entry.body === undefined ? {} : { body: entry.body.slice(0, 3000) }) })) }),
        text: { format: { type: "json_schema", name: "semantic_selection", strict: true, schema } },
      }, deadline === undefined ? undefined : { timeout: Math.max(1, deadline - Date.now()) });
      if (response.status !== "completed") throw new SelectionUnavailable();
      const raw = JSON.parse(response.output_text);
      if (!raw || Object.keys(raw).length !== 1 || !Array.isArray(raw.matches) || raw.matches.length > batch.length) throw new SelectionUnavailable();
      const seen = new Set<number>();
      for (const match of raw.matches) {
        if (!match || Object.keys(match).length !== 3 || !Number.isInteger(match.index) || match.index < 0 || match.index >= batch.length || seen.has(match.index)
          || typeof match.score !== "number" || !Number.isFinite(match.score) || match.score < 0 || match.score > 1
          || typeof match.evidence !== "string" || !match.evidence.trim() || !message.includes(match.evidence)) throw new SelectionUnavailable();
        seen.add(match.index);
        matches.push({ index: start + match.index, score: match.score, evidence: match.evidence });
      }
    };
    // Independent read-only batches share one deadline and publish no partial selection.
    for (let start = 0; start < entries.length; start += 400)
      await Promise.all([0, 100, 200, 300].map(offset => start + offset).filter(index => index < entries.length).map(readBatch));
    return matches.sort((a, b) => b.score - a.score || a.index - b.index);
  } catch { throw new SelectionUnavailable(); }
}


// Reuse identical reads only inside one message execution, never across tenants,
// conversations or catalog changes on later turns.
const selections = new AsyncLocalStorage<Map<string, Promise<SemanticSelection[]>>>();
export function withSemanticSelections<T>(run: () => T): T {
  return selections.getStore() ? run() : selections.run(new Map(), run);
}
export async function selectSemanticCandidates(kind: "identity" | "relevance", entries: readonly SemanticCandidate[], message: string, deadline?: number): Promise<SemanticSelection[]> {
  const cache = selections.getStore();
  if (!cache) return executeSelection(kind, entries, message, deadline);
  const key = JSON.stringify([kind, entries, message]);
  let pending = cache.get(key);
  if (!pending) { pending = executeSelection(kind, entries, message, deadline); cache.set(key, pending); }
  return structuredClone(await pending);
}
