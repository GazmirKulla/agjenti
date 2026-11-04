import { createServiceSupabase } from "@/lib/supabase/service";
import { operationActor } from "./access";
import { uuid } from "@/lib/calendar/model";
const sources = {
  plan: { table: "business_operation_plans", columns: "id,title,state,created_at,updated_at", name: "title", module: "settings" },
  order: { table: "orders", columns: "id,conversation_id,customer_id,status,total_amount,currency,created_at", name: "status", module: "orders" },
  customer: { table: "customers", columns: "id,display_name,phone,username,created_at", name: "display_name", module: "customers" },
  conversation: { table: "conversations", columns: "id,customer_id,participant_display_name,participant_username,status,channel,auto_reply,updated_at", name: "participant_display_name", module: "inbox" },
  training: { table: "agent_training_memories", columns: "id,kind,instruction,is_active,revision,updated_at", name: "instruction", module: "agents" },
  product_type: { table: "product_types", columns: "id,name,is_active", name: "name", module: "products" },
} as const;
export function isOperationalSearch(kind: string): kind is keyof typeof sources { return Object.hasOwn(sources, kind); }
export async function searchOperations(businessId: string, userId: string, input: { kind: string; query: string; offset?: string; customer_id?: string; status?: string }, accessToken?: string) {
  await operationActor(businessId, userId, accessToken);
  if (!isOperationalSearch(input.kind)) throw Error("Kërkim i pambështetur.");
  const source = sources[input.kind]; const offset = Number(input.offset ?? 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000 || typeof input.query !== "string" || input.query.length > 120) throw Error("Filtra të pavlefshëm.");
  let query = createServiceSupabase().from(source.table).select(source.columns);
  if (input.kind !== "product_type") query = query.eq("business_id", businessId);
  else query = query.eq("is_active", true);
  if (input.kind === "plan") query = query.eq("user_id", userId);
  if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(input.query)) query = query.eq("id", input.query);
  else if (input.query.trim() && input.query !== "*") query = query.ilike(source.name, `%${input.query.trim().replace(/[\\%_]/g, "\\$&")}%`);
  if (input.customer_id) {
    if (!uuid(input.customer_id) || !["order", "conversation"].includes(input.kind)) throw Error("Filtri i klientit nuk është i vlefshëm.");
    query = query.eq("customer_id", input.customer_id);
  }
  if (input.status) {
    if (!["order", "conversation"].includes(input.kind) || !/^[a-z_]{1,50}$/.test(input.status)) throw Error("Status i pavlefshëm.");
    query = query.eq("status", input.status);
  }
  const result = await query.order("id").range(offset, offset + 30).returns<Record<string, unknown>[]>();
  if (result.error) throw Error("Kërkimi nuk u përfundua.");
  const rows = result.data ?? [];
  return { kind: input.kind, query: input.query, rows: rows.slice(0, 30), partial: rows.length > 30, nextOffset: rows.length > 30 ? offset + 30 : null };
}
