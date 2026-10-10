import { randomUUID } from "node:crypto";
import { createServiceSupabase } from "@/lib/supabase/service";
import { encryptSecret } from "@/lib/crypto/tokens";
import { parseOrderSteps } from "@/lib/workflows/order-definition";
import { uuid } from "@/lib/calendar/model";
import { AssistantError, type Proposal, type Preview } from "./model";
import type { Access, Ticket } from "./service";
import type { WorkflowStepDef } from "@/lib/workflows/engine";

export type OrderFlow = { id: string; name: string; steps: WorkflowStepDef[] };
export type OrderFlowProduct = {
  id: string;
  name: string;
  workflow_id: string | null;
  updated_at: string;
};
export type OrderFlowContext = {
  flows: OrderFlow[];
  products: OrderFlowProduct[];
  partial: boolean;
};
function authorize(access: Access, write = false) {
  if (
    !access.modules.includes("workflows") ||
    !access.modules.includes("products")
  )
    throw new AssistantError(
      "Aktivizo modulet Workflow dhe Produkte për rrjedhat e porosive.",
    );
  if (write && access.catalogSource === "external")
    throw new AssistantError(
      "Lidhjet e produkteve menaxhohen nga katalogu i jashtëm.",
    );
}
export async function loadOrderFlows(
  access: Access,
  id?: string | null,
): Promise<OrderFlowContext> {
  authorize(access);
  const db = createServiceSupabase();
  let query = db
    .from("workflows")
    .select("id,name,workflow_steps(key,kind,position,required,config)")
    .eq("business_id", access.businessId);
  if (id) query = query.eq("id", id);
  const [flows, products] = await Promise.all([
    query.order("created_at", { ascending: false }).limit(61),
    db
      .from("products")
      .select("id,name,workflow_id,updated_at")
      .eq("business_id", access.businessId)
      .order("name")
      .limit(201),
  ]);
  if (flows.error || products.error)
    throw new AssistantError("Nuk u lexuan rrjedhat e produkteve.");
  if (id && !flows.data?.length)
    throw new AssistantError("Workflow-i nuk u gjet në këtë biznes.");
  return {
    flows: (flows.data ?? [])
      .slice(0, 60)
      .map((flow) => ({
        id: flow.id,
        name: flow.name,
        steps: [...(flow.workflow_steps ?? [])]
          .sort((a, b) => a.position - b.position)
          .map((step) => ({
            key: step.key,
            kind: step.kind as WorkflowStepDef["kind"],
            required: step.required,
            label:
              typeof step.config?.label === "string"
                ? step.config.label
                : step.key,
          })),
      })),
    products: (products.data ?? []).slice(0, 200),
    partial:
      (flows.data?.length ?? 0) > 60 || (products.data?.length ?? 0) > 200,
  };
}
export async function prepareOrderFlow(
  access: Access,
  p: Proposal,
  expected?: OrderFlow,
) {
  authorize(access, p.action !== "orderflow_read");
  const context = await loadOrderFlows(access, p.id);
  if (p.action === "orderflow_read")
    return {
      message: "Këto janë hapat e porosive dhe produktet e lidhura me ta.",
      orderflows: context,
    };
  const input = Object.fromEntries(p.changes.map((c) => [c.field, c.value]));
  const source = p.id ? context.flows.find((f) => f.id === p.id) : undefined;
  if (p.action !== "orderflow_create" && !source)
    throw new AssistantError("Zgjidh rrjedhën që dëshiron të ndryshosh.");
  if (expected && JSON.stringify(source) !== JSON.stringify(expected))
    throw new AssistantError("Hapat ndryshuan gjatë analizës. Provo përsëri.");
  let ids: string[];
  try {
    ids = JSON.parse(input.product_ids ?? "[]");
  } catch {
    throw new AssistantError("Zgjidh produktet përkatëse.");
  }
  if (
    !Array.isArray(ids) ||
    ids.length > 200 ||
    ids.some((id) => !uuid(id)) ||
    new Set(ids).size !== ids.length
  )
    throw new AssistantError("Zgjidh produkte të vlefshme, pa përsëritje.");
  if (input.scope === "all") {
    if (!source || context.partial)
      throw new AssistantError(
        "Përcakto produktet që duhen ndryshuar; lista nuk është e plotë.",
      );
    ids = context.products
      .filter((p) => p.workflow_id === source.id)
      .map((p) => p.id);
  } else if (p.action === "orderflow_update" && input.scope !== "selected")
    throw new AssistantError(
      "Ndryshimi vlen për të gjitha produktet apo vetëm për disa?",
    );
  const missingIds = ids.filter(
    (id) => !context.products.some((p) => p.id === id),
  );
  if (missingIds.length) {
    const { data, error } = await createServiceSupabase()
      .from("products")
      .select("id,name,workflow_id,updated_at")
      .eq("business_id", access.businessId)
      .in("id", missingIds);
    if (error) throw new AssistantError("Produktet nuk u lexuan.");
    context.products.push(...(data ?? []));
  }
  const products = ids.map((id) => context.products.find((p) => p.id === id));
  if (products.some((p) => !p))
    throw new AssistantError(
      "Një produkt nuk u gjet në listë. Specifiko produktin përpara lidhjes.",
    );
  if (
    p.action === "orderflow_update" &&
    products.some((product) => product!.workflow_id !== source?.id)
  )
    throw new AssistantError(
      "Zgjidh produktet që përdorin këtë rrjedhë. Për produktet e tjera përdor lidhjen e workflow-t.",
    );
  if (p.action === "orderflow_assign" && !products.length)
    throw new AssistantError("Zgjidh të paktën një produkt për lidhjen.");
  let definition: OrderFlow;
  try {
    const name = input.name ?? source?.name;
    if (!name?.trim() || name.length > 120)
      throw new Error("Vendos emrin e rrjedhës.");
    const steps = parseOrderSteps(
      input.steps ? JSON.parse(input.steps) : source?.steps,
    );
    definition = { id: source?.id ?? "", name: name.trim(), steps };
  } catch (e) {
    throw new AssistantError((e as Error).message);
  }
  if (p.action === "orderflow_assign" && (input.name || input.steps))
    throw new AssistantError("Lidhja nuk mund të ndryshojë hapat.");
  const stepNames = {text:"Tekst",choice:"Zgjedhje",photo:"Foto",confirm:"Konfirmim",customer:"Të dhënat e klientit"};
  const stepText = (flow?: OrderFlow) =>
    flow?.steps.map((s, i) => `${i + 1}. ${s.label} (${stepNames[s.kind]})`).join("\n") ??
    "—";
  const preview: Preview = {
    title:
      p.action === "orderflow_assign"
        ? "Lidh rrjedhën me produktet"
        : "Ruaj rrjedhën e porosisë",
    subject: definition.name,
    fields: [
      ...(p.action !== "orderflow_assign"
        ? [
            {
              label: "Emri",
              before: source?.name ?? "—",
              after: definition.name,
            },
            {
              label: "Hapat",
              before: stepText(source),
              after: stepText(definition),
            },
          ]
        : []),
      ...products.map((product) => ({
        label: product!.name,
        before:
          context.flows.find((f) => f.id === product!.workflow_id)?.name ??
          (product!.workflow_id ? "Workflow ekzistues" : "Pa workflow"),
        after: definition.name,
      })),
    ],
    notice: products.length
      ? "Krijohet ose lidhet rrjedha për porositë e reja. Porositë në proces vazhdojnë me hapat e mëparshëm. Aktivizimi i produkteve nuk ndryshon."
      : "Ruhet në listën e workflow-ve; nuk ndryshon asnjë produkt derisa ta lidhësh.",
  };
  const operation = p.action.slice("orderflow_".length);
  const ticket: Ticket = {
    purpose: "business-assistant-v1",
    userId: access.userId,
    businessId: access.businessId,
    expires: Date.now() + 600000,
    action: p.action,
    id: randomUUID(),
    before: source ? { ...source } : null,
    values: {
      operation,
      name: definition.name,
      steps: definition.steps,
      products,
      scope: input.scope ?? "selected",
    },
  };
  return {
    message: p.message,
    editableFlow: true,
    preview,
    token: encryptSecret(JSON.stringify(ticket)),
  };
}
export async function executeOrderFlow(access: Access, ticket: Ticket) {
  authorize(access, true);
  const { error } = await createServiceSupabase().rpc(
    "apply_assistant_orderflow",
    {
      p_business: access.businessId,
      p_user: access.userId,
      p_request: ticket.id,
      p_action: ticket.action,
      p_before: ticket.before,
      p_values: ticket.values,
    },
  );
  if (error)
    throw new AssistantError(
      ["PGRST202", "42883", "42P01"].includes(error.code)
        ? "Ruajtja e rrjedhave të produkteve kërkon migrimin e ri të workflow-ve nga administratori."
        : error.message.includes("stale")
          ? "Rrjedha ose produktet ndryshuan. Analizo kërkesën përsëri."
          : "Rrjedha nuk u ruajt. Kontrollo të dhënat dhe provo përsëri.",
    );
  return {
    message:
      "Rrjedha dhe lidhjet me produktet u ruajtën. Porositë në proces ruajnë hapat e mëparshëm.",
    path: "workflows",
  };
}
export const orderFlowInstructions = `When data.pendingOrderflow exists, the owner is refining an unconfirmed proposal. Keep its same action and id; preserve its proposed name/steps/products unless explicitly changed. Product ORDER workflows are separate from business visual workflows. Use orderflow_load (id null, changes []) ONLY when data.orderflows is absent. Once data.orderflows is present, do not load it again. An empty flows array is a verified empty library, not missing context: create the new workflow when the user explicitly requested creation. orderflow_read (id null to list or existing workflow UUID) returns a rendered list. orderflow_create (id null) and orderflow_update (existing id) use fields name and steps (JSON array {key,kind,label,required:true}); preserve unrelated steps and stable keys. Supported kinds: text,choice,photo,confirm,customer. Labels are the actual questions. Customer collection must appear exactly once LAST; it collects name/phone/city/address and ends the order. Confirmation only advances on yes. choice/text accept free text; no invented enum validation. Product attribute collection does not change the product type configuration. orderflow_update requires scope all or selected; ask which if a workflow has several linked products and the user did not specify. product_ids is a JSON array of verified product UUIDs; for scope all server resolves all currently linked products and previews them. orderflow_assign uses existing workflow id and product_ids only, no name/steps. Each update creates a NEW copy and assigns the chosen products atomically, retaining the old definition for existing orders. An update with no chosen products only creates a library copy. No product activation. If context is partial, ask for narrower scope; do not claim a complete list. Never edit the business visual workflow as a substitute for product order steps. Keep names distinguishable when creating new variants.`;

/** A sealed proposal is the sole source of retained edits; client JSON cannot supply them. */
export function refineOrderFlowProposal(ticket: Ticket, proposal: Proposal): Proposal {
  if (ticket.action !== proposal.action || (ticket.before?.id ?? null) !== proposal.id) throw new AssistantError("Për një rrjedhë tjetër, anulo propozimin aktual dhe nis kërkesë të re.");
  const values: Record<string,string> = {
    product_ids: JSON.stringify((ticket.values.products as OrderFlowProduct[]).map(p => p.id)),
    ...(ticket.action === "orderflow_assign" ? {} : {name:String(ticket.values.name),steps:JSON.stringify(ticket.values.steps),scope:String(ticket.values.scope)}),
    ...Object.fromEntries(proposal.changes.map(c => [c.field,c.value])),
  };
  return {...proposal,changes:Object.entries(values).map(([field,value])=>({field,value}))};
}
