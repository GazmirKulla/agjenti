import type { BusinessGrounding, GroundedKnowledge, GroundedService } from "@/lib/agents/business-grounding";
import type { TrainingMemory } from "@/lib/agents/training/model";
import type { AgentConfigurationPreview } from "@/lib/agents/communication-configuration";
import { defaultCommunicationPolicy, parseCommunicationPolicy } from "@/lib/agents/communication-policy";
import { operationId, withStyleBlock } from "./apply";
import type { Edit } from "./review";

/** What a training session would change, held in memory for an isolated test turn:
 * nothing of it is saved, and the live agent never reads it. */
export type TrainingPreview = {
  businessId: string;
  memories: TrainingMemory[];
  knowledge: GroundedKnowledge[];
  services: GroundedService[];
  /** New prices of existing products and services, by id. */
  prices: Record<string, { price_amount: number; price_max: number | null; price_mode: "fixed" | "from" | "range"; currency: string }>;
};

export type PreviewRow = {
  id: string; destination: string; operation: string; status: string; target_table: string | null; target_id: string | null;
  title: string; proposed: Record<string, unknown>; edited: Edit | null;
};
type Agent = { id: string; name: string; instructions: string; communication: unknown; updated_at: string; configuration_revision: number };
type Price = { min: number; max: number | null; currency: string; approximate?: boolean; condition?: string | null };

const value = (row: PreviewRow, edited: keyof Edit, proposed: string) => String((row.edited?.[edited] as string | undefined) ?? row.proposed[proposed] ?? "").trim();
const priceOf = (row: PreviewRow): Price | null => {
  if (row.edited && "price" in row.edited) return row.edited.price ?? null;
  const p = row.proposed.price as Price | null | undefined;
  return p ? { min: Number(p.min), max: p.max == null ? null : Number(p.max), currency: String(p.currency ?? "ALL"), approximate: !!p.approximate, condition: p.condition ?? null } : null;
};
const priceText = (p: Price) => `${p.min}${p.max ? `–${p.max}` : ""} ${p.currency === "ALL" ? "lekë" : p.currency}${p.condition ? ` (${p.condition})` : ""}`;

/** The same result the apply step would write, for every suggestion not rejected. */
export function buildPreview(businessId: string, agent: Agent | null, rows: PreviewRow[]): { configuration: AgentConfigurationPreview | null; training: TrainingPreview } {
  const live = rows.filter((r) => ["pending", "approved", "failed"].includes(r.status) && r.operation !== "duplicate");
  const training: TrainingPreview = { businessId, memories: [], knowledge: [], services: [], prices: {} };
  let configuration: AgentConfigurationPreview | null = null;
  const now = new Date().toISOString();
  for (const row of live) {
    const id = operationId(row.id, "preview");
    if (row.destination === "style" && agent) {
      let communication;
      try { communication = parseCommunicationPolicy(agent.communication); } catch { communication = { ...defaultCommunicationPolicy }; }
      const policy = row.proposed.policy as Record<string, string> | undefined;
      configuration = {
        businessId, agentId: agent.id, name: agent.name, updatedAt: agent.updated_at, revision: agent.configuration_revision,
        instructions: withStyleBlock(agent.instructions ?? "", value(row, "instructions", "instructions")),
        communication: parseCommunicationPolicy({ ...communication, ...(policy ? { tone: policy.tone, length: policy.length, emoji: policy.emoji, questions: policy.questions } : {}) }),
      };
    } else if (row.destination === "example") {
      training.memories.push({ id, business_id: businessId, kind: "example", instruction: `Shembull real nga bisedat: ${String(row.proposed.situation ?? "")}`.trim(),
        customer_message: value(row, "customer_message", "customer_message"), desired_response: value(row, "desired_response", "desired_response"),
        workflow_id: null, step_key: null, is_active: true, revision: 1, updated_at: now });
    } else if (["knowledge", "profile", "gap", "workflow"].includes(row.destination)) {
      const title = row.destination === "gap" ? value(row, "title", "question") : row.destination === "profile" ? String(row.proposed.title ?? row.title) : value(row, "title", row.destination === "workflow" ? "name" : "title") || row.title;
      const steps = Array.isArray(row.proposed.steps) ? (row.proposed.steps as string[]).map((s, i) => `${i + 1}. ${s}`).join("\n") : "";
      const body = value(row, "body", "body") || steps;
      // An unanswered question without the owner's answer teaches nothing.
      if (!body) continue;
      const replaces = row.target_table === "knowledge_entries" && row.target_id && row.operation !== "create" ? row.target_id : null;
      training.knowledge.push({ id: replaces ?? id, title, body, intent_key: null, updated_at: now });
    } else if (row.destination === "service" || row.destination === "product") {
      const price = priceOf(row);
      if (row.operation === "create") {
        // New products are drafts: the live agent would not offer them yet, so neither does the test.
        if (row.destination === "product") continue;
        const description = [value(row, "description", "description"), price?.max ? `Çmimi: ${priceText(price)}.` : ""].filter(Boolean).join("\n");
        training.services.push({ id, name: value(row, "name", "name"), description, price_amount: price?.min ?? null, currency: price?.currency ?? "ALL",
          price_mode: price ? (price.max || price.approximate ? "from" : "fixed") : "request", duration_minutes: 30, booking_enabled: false });
      } else if (row.target_id && price) {
        training.prices[row.target_id] = row.destination === "product"
          ? { price_amount: price.min, price_max: price.max, price_mode: price.max ? "range" : price.approximate ? "from" : "fixed", currency: price.currency }
          : { price_amount: price.min, price_max: null, price_mode: price.max || price.approximate ? "from" : "fixed", currency: price.currency };
      }
    }
  }
  return { configuration, training };
}

/** Adds the preview to what the test turn reads from the business, replacing entries it updates. */
export function applyTrainingPreview(grounding: BusinessGrounding, preview: TrainingPreview) {
  const knowledge = new Map(grounding.knowledge.records.map((r) => [r.id, r]));
  for (const entry of preview.knowledge) knowledge.set(entry.id, entry);
  grounding.knowledge.records = [...knowledge.values()];
  grounding.services.records = [...grounding.services.records, ...preview.services];
  for (const records of [grounding.products.records, grounding.services.records] as { id: string; price_amount?: number | null }[][]) {
    for (const record of records) if (preview.prices[record.id]) Object.assign(record, preview.prices[record.id]);
  }
  for (const read of [grounding.knowledge, grounding.services]) if (read.total !== null) read.total = read.records.length;
  return grounding;
}
