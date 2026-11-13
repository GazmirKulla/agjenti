import { prompt } from "@/lib/ai/prompts/files";
import { OperationError } from "@/lib/actions/operations/error";
import { applyRequestedWorkflow } from "./workflow-apply";
import { configurationInstructions, orderFlowInstructions, linearInstructions, workflowPlanningContract, automationInstructions, actionPlanInstructions, workflowEditorInstructions as baseWorkflowInstructions } from "./prompts";
import { reviewConfigurationRequest } from "./configuration-review";
import { parseConfigurationSteps } from "@/lib/actions/operations/configuration-policy";
import { prepareConfigurationPlan, executeConfigurationPlan, loadConfigurationPlan, renewConfigurationPlan } from "@/lib/actions/operations/plans";
import { prepareOperationPlan, resumeOperationPlan, executeOperationPlan, type PreparedPlan } from "@/lib/actions/operations/plans";
import { isOperationalSearch, searchOperations } from "@/lib/actions/operations/search";
import { assistantOperationCatalog } from "@/lib/actions/operations/catalog";
import { prepareOperation, executeOperation, type PreparedOperation } from "@/lib/actions/operations/service";
import { requireActionAccess } from "@/lib/actions/access";
import { observeAgentEffect, requireAgentConfigurationAccess } from "@/lib/agents/configuration";
import { configurationEffectMessage, type AgentConfigurationEffect } from "@/lib/agents/configuration-contract";
import { defaultPersonalAssistantName, readPersonalAssistantName } from "./identity";
import { modelPlanContext, type PlanningPreferences, type RecoverablePlan } from "./persistence-model";
import { openImportSource } from "@/lib/products/import-service";
import { importFields, type ImportField, type ImportSource } from "@/lib/products/import-model";
import type { AssistantMaterial } from "./materials";
import { loadOrderFlows, prepareOrderFlow, executeOrderFlow, type OrderFlowContext, refineOrderFlowProposal } from "./orderflow-service";
import { loadLinearContext, prepareLinear, executeLinear, type LinearCard } from "./linear-service";
import { loadAssistantWorkflow, prepareWorkflow, executeWorkflow, simulateAutomation } from "./workflow-service";
import { automationIntentSchema } from "./automation-intent";
import { buildAutomationProposal, automationMessage, type AutomationProposal } from "./automation-proposal";
import { summarizeWorkflowChanges } from "./semantic-summary";
import { toActionPlan, type ActionPlan } from "./action-plan";
/** Prompt text: prompts/asistenti/pjeset/workflow-rregullat (bashkë me pjesët e workflow-t).md */
export const workflowInstructions = () => `${workflowPlanningContract()} ${automationInstructions()} ${baseWorkflowInstructions()} ${actionPlanInstructions()} ${prompt("asistenti/pjeset/workflow-rregullat")}`;

/** Prompt text: prompts/asistenti/prompti-kryesor.md */
export const OWNER_ASSISTANT_PROMPT = (modules: string[], external: boolean) => prompt("asistenti/prompti-kryesor", { konfigurimi: configurationInstructions(), porosite: orderFlowInstructions(), workflow: workflowInstructions(), linear: linearInstructions(), fushat: JSON.stringify(fields), modulet: modules.join(","), katalogu_i_jashtem: String(external) });
import { applyWorkflowOperations, workflowProblems, WorkflowProposalError, type WorkflowCard } from "./workflow";
import { emptyVisualGraph, nodeLabels, outputPorts, validateVisualGraph } from "@/lib/workflows/visual/model";
import type { VisualNodeKind } from "@/lib/workflows/visual/types";
import type { SimulationBinding } from "@/lib/workflows/visual/simulation-types";
import type { PublicationApproval } from "@/lib/workflows/visual/publication-types";
import { parseUIContext, type AssistantUIContext } from "./context";
import OpenAI from "@/lib/ai/openai";
import { randomUUID } from "node:crypto";
import { createServiceSupabase } from "@/lib/supabase/service";
import { encryptSecret, decryptSecret } from "@/lib/crypto/tokens";
import { modelFor } from "@/lib/agents/generate";
import { assessBusinessCapabilities, summarizeCapabilityAssessments } from "@/lib/capabilities/assessment";
import { capabilityRegistry } from "@/lib/capabilities/registry";
import {
  availableSlots,
  persistBooking,
  bookingColumns,
} from "@/lib/calendar/service";
import { defaultSettings, zonedParts } from "@/lib/calendar/model";
import { serviceColumns } from "@/lib/services/model";
import {
  actions,
  fields,
  moduleFor,
  readProposal,
  valuesFor,
  previewFor,
  AssistantError,
  type Action,
  type Row,
  type Proposal,
  type Preview,
} from "./model";

const tables: Record<string, string> = {
  product: "products",
  agent: "ai_agents",
  service: "booking_services",
  knowledge: "knowledge_entries",
  profile: "businesses",
  booking: "bookings",
};
const columns: Record<string, string> = {
  agent: "id,name,instructions,is_active,updated_at,communication,configuration_revision,configuration_draft",
  product: "id,name,description,sku,image_url,price_amount,currency,is_active,archived_at,product_type_id,updated_at,workflow_id",
  service: serviceColumns,
  knowledge: "id,title,body,intent_key,is_active,updated_at",
  profile: "id,name,updated_at",
  booking: bookingColumns,
};
export type PlanResult = { saved?: boolean; outcome?: {status: string; action: string; reference: {table: string; id?: string; request_key?: string}}; configuration?: {planId: string; state: "blocked" | "completed"; completed: string[]; total: number}; replacePlan?: boolean; briefing?: import("./briefing-model").Briefing; actionPlan?: ActionPlan; automation?: AutomationProposal; productImport?: ImportSource; clarifying?: boolean; linear?: LinearCard; choices?: string[]; message: string; token?: string; preview?: Preview; workflow?: WorkflowCard; orderflows?: OrderFlowContext; editableFlow?: boolean; slots?: string[] };
export type Access = {
  /** Request-scoped user JWT for RLS reads; never persisted or included in model input. */
  accessToken?: string;
  userId: string;
  businessId: string;
  modules: string[];
  catalogSource: string;
};
export type Ticket = {
  publicationApproval?: PublicationApproval;
  simulation?: SimulationBinding;
  automation?: AutomationProposal;
  purpose: "business-assistant-v1";
  userId: string;
  businessId: string;
  expires: number;
  action: Action;
  id: string;
  before: Row | null;
  values: Row;
  serviceVersion?: { id: string; updatedAt: string };
};
export function assertEnabled(access: Access, action: Action) {
  if (action === "automation_plan") throw new AssistantError("Plani është vetëm për shqyrtim; nuk është konfirmim për ekzekutim.");
  if (action === "clarify" || action.startsWith("operation")) return;
  if (!access.modules.includes(moduleFor(action)))
    throw new AssistantError(
      "Ky funksion nuk është aktiv në hapësirën e biznesit.",
    );
  if (action.startsWith("product_") && access.catalogSource === "external")
    throw new AssistantError(
      "Ky katalog menaxhohet nga burimi i jashtëm. Ndrysho produktin atje.",
    );
}
export function openTicket(token: string, access: Access): Ticket {
  let t: Ticket;
  try {
    t = JSON.parse(decryptSecret(token));
  } catch {
    throw new AssistantError(
      "Konfirmimi nuk është i vlefshëm. Përgatite kërkesën përsëri.",
    );
  }
  if (
    t.purpose !== "business-assistant-v1" ||
    t.userId !== access.userId ||
    t.businessId !== access.businessId ||
    !Number.isFinite(t.expires) ||
    t.expires <= Date.now()
  )
    throw new AssistantError(
      "Konfirmimi ka skaduar ose i përket një hapësire tjetër. Përgatite kërkesën përsëri.",
      t.action === "workflow_publish" && t.userId === access.userId && t.businessId === access.businessId
        ? { mode: "assistant_strict", result: "BLOCKED", status: "stale_proposal", canPublish: false, canRequestApproval: false,
          baseRevision: Number.isInteger(t.before?.revision) ? Number(t.before?.revision) : 0, candidateGraphHash: null,
          findings: [{ code: "expired_approval", message: "Miratimi ka skaduar. Përgatite dhe kontrollo propozimin përsëri." }] }
        : undefined,
    );
  assertEnabled(access, t.action);
  return t;
}
async function loadRow(access: Access, kind: string, id: string) {
  const db = createServiceSupabase();
  let query = db
    .from(tables[kind])
    .select(columns[kind])
    .eq("id", kind === "profile" ? access.businessId : id);
  if (kind !== "profile") query = query.eq("business_id", access.businessId);
  const result = await query.returns<Row[]>().maybeSingle();
  if (result.error || !result.data)
    throw new AssistantError(
      "Elementi nuk u gjet në këtë biznes. Specifiko emrin e saktë.",
    );
  if (kind === "knowledge" && result.data.intent_key === "service")
    throw new AssistantError(
      "Këto njohuri përditësohen nga shërbimi. Ndrysho shërbimin përkatës.",
    );
  return result.data as Row;
}
async function timezoneFor(businessId: string) {
  const result = await createServiceSupabase()
    .from("business_calendar_settings")
    .select("timezone")
    .eq("business_id", businessId)
    .maybeSingle();
  if (result.error)
    throw new AssistantError("Cilësimet e kalendarit nuk u lexuan.");
  return result.data?.timezone ?? defaultSettings.timezone;
}
export async function searchContext(access: Access, p: Proposal) {
  const search = Object.fromEntries(p.changes.map((c) => [c.field, c.value]));
  const kind = search.kind;
  if (isOperationalSearch(kind)) return searchOperations(access.businessId, access.userId, search as { kind: string; query: string }, access.accessToken);
  if (
    !["product", "service", "knowledge", "booking", "agent"].includes(kind) ||
    !search.query?.trim() ||
    search.query.length > 120
  )
    throw new AssistantError(
      "Specifiko emrin e produktit, shërbimit ose klientit.",
    );
  // Searching an externally managed catalog is read-only; only catalog mutations are blocked.
  if (!access.modules.includes(moduleFor(`${kind}_update` as Action)))
    throw new AssistantError("Ky funksion nuk është aktiv në hapësirën e biznesit.");
  const nameColumn =
    kind === "knowledge"
      ? "title"
      : kind === "booking"
        ? "customer_name"
        : "name";
  const pattern = search.query.trim().replace(/[\\%_]/g, "\\$&");
  const { data, error } = await createServiceSupabase()
    .from(tables[kind])
    .select(columns[kind])
    .eq("business_id", access.businessId)
    .ilike(nameColumn, `%${pattern}%`)
    .order(kind === "booking" ? "starts_at" : "updated_at", {
      ascending: false,
    })
    .limit(61)
    .returns<Row[]>();
  if (error) throw new AssistantError("Kërkimi nuk përfundoi. Provo përsëri.");
  return {
    kind,
    query: search.query,
    partial: (data?.length ?? 0) > 60,
    rows: (data ?? [])
      .slice(0, 60)
      .filter((r) => kind !== "knowledge" || r.intent_key !== "service")
      .map((r) =>
        Object.fromEntries(
          Object.entries(r).filter(
            ([key]) => !["google_event_id", "google_calendar_id"].includes(key),
          ),
        ),
      ),
  };
}
export async function loadSelectedContext(access: Access, context?: AssistantUIContext) {
  if (!context?.entityType || !context.entityId) return undefined;
  if(!access.modules.includes(moduleFor(`${context.entityType}_update` as Action))) throw new AssistantError("Ky funksion nuk është aktiv në hapësirën e biznesit.");
  const row = await loadRow(access, context.entityType, context.entityId);
  return Object.fromEntries(Object.entries(row).filter(([key]) => !["google_event_id", "google_calendar_id"].includes(key)));
}
export async function planRequest(
  access: Access,
  text: string,
  history: { role: "user" | "assistant"; content: string }[],
  uiContext?: AssistantUIContext,
  pendingToken?: string,
  materials: AssistantMaterial[] = [],
  assistantName?: string,
  recoveredPlan?: RecoverablePlan,
  planningPreferences: PlanningPreferences = {},
): Promise<PlanResult> {
  const validatedContext = parseUIContext(uiContext);
  if (!process.env.OPENAI_API_KEY)
    throw new AssistantError("Asistenti AI nuk është konfiguruar ende.");
  const db = createServiceSupabase();
  const selectedProducts = validatedContext?.selectedEntityIds?.length && validatedContext.selectedEntityIds.length > 1
    ? await Promise.all(validatedContext.selectedEntityIds.map(id => {
      if (!access.modules.includes("products")) throw new AssistantError("Produktet nuk janë aktivë në këtë biznes.");
      return loadRow(access,"product",id);
    })) : [];
  const selected = await loadSelectedContext(access, validatedContext);
  const context: Record<string, unknown> = {};
  // Recovery is descriptive context, never an approval or a sealed ticket.
  if (recoveredPlan) {
    try { context.recoveredPlan = modelPlanContext(recoveredPlan, planningPreferences); }
    catch (error) { throw new AssistantError((error as Error).message); }
  }
  context.ownerOperations = assistantOperationCatalog();
  context.workflowAuthoring = {
    resetGraph: emptyVisualGraph(),
    nodePorts: Object.fromEntries((Object.keys(nodeLabels) as VisualNodeKind[]).map(kind => [kind, outputPorts(kind)])),
    resetBehavior: "reset produces exactly resetGraph with your requested name. Add only desired nodes and flows. Do not remove old nodes after reset; they are already gone. Preserve the start-to-end scaffold for the hub unless deliberately replacing it. Every new process needs put_flow. Terminal handoff/end nodes have NO outgoing edges.",
  };
  context.capabilityDefinitions = Object.values(capabilityRegistry).map(({ key, description }) => ({ key, description }));
  try {
    const capabilityAssessments = await assessBusinessCapabilities(access.businessId, { userId: access.userId });
    context.capabilities = summarizeCapabilityAssessments(capabilityAssessments);
  } catch {
    // Capability metadata is advisory planner context. Existing action-specific
    // authorization and validation remain authoritative if readiness is unavailable.
    context.capabilities = Object.keys(capabilityRegistry).map((capabilityKey) => ({
      capabilityKey,
      status: "needs_clarification" as const,
      reasonCode: "assessment_unavailable",
      missingRequirements: ["capability_assessment"],
    }));
  }
  let pendingWorkflow: Ticket | undefined;
  let pendingOrderFlow: Ticket | undefined;
  let pendingLinear: Ticket | undefined;
  if (pendingToken) {
    const ticket = openTicket(pendingToken, access);
    if (ticket.action === "workflow_draft") pendingWorkflow = ticket;
    else if (["orderflow_create","orderflow_update","orderflow_assign"].includes(ticket.action)) pendingOrderFlow = ticket;
    else if (["linear_draft", "linear_link"].includes(ticket.action)) pendingLinear = ticket;
    else throw new AssistantError("Ky propozim nuk është rrjedhë.");
  }
  const relevant: Record<string,string[]> = {products:["product","profile"],services:["service","profile"],knowledge:["knowledge","profile"],agents:["agent","knowledge","profile"],bookings:["booking","service","profile"],calendar:["booking","service","profile"]};
  const kinds = relevant[validatedContext?.page ?? ""] ?? [
    "product",
    "service",
    "knowledge",
    "profile",
    "booking",
    "agent",
  ];
  await Promise.all(
    kinds.map(async (kind) => {
      const action = `${kind}_update` as Action;
      if (!access.modules.includes(moduleFor(action))) return;
      let query = db.from(tables[kind]).select(columns[kind], { count: "exact" });
      query =
        kind === "profile"
          ? query.eq("id", access.businessId)
          : query.eq("business_id", access.businessId);
      if (kind === "booking")
        query = query
          .gte("starts_at", new Date(Date.now() - 30 * 86400000).toISOString())
          .order("starts_at");
      else query = query.order("updated_at", { ascending: false });
      const { data, error, count } = await query.limit(61).returns<Row[]>();
      if (error)
        throw new AssistantError(
          "Të dhënat nuk u lexuan. Provo përsëri pas pak.",
        );
      // The planner never receives credentials or cross-tenant rows. The limit is explicit, not a claim that the catalog is complete.
      context[kind] = {
        total: count ?? null,
        returnedCount: Math.min(data?.length ?? 0, 60),
        partial: (count ?? data?.length ?? 0) > 60,
        rows: (data ?? [])
          .slice(0, 60)
          .filter((r) => kind !== "knowledge" || r.intent_key !== "service")
          .map((r) =>
            Object.fromEntries(
              Object.entries(r).filter(
                ([k]) => !["google_event_id", "google_calendar_id"].includes(k),
              ),
            ),
          ),
      };
    }),
  );
  if (selected && validatedContext?.entityType) {
    const group = context[validatedContext.entityType] as {rows: Row[]};
    group.rows = [selected, ...group.rows.filter(row => row.id !== selected.id)];
  }
  if (selectedProducts.length) {
    const group = context.product as {rows:Row[]};
    group.rows = [...selectedProducts, ...group.rows.filter(row => !selectedProducts.some(p => p.id === row.id))];
  }
  if (pendingOrderFlow) {
    context.orderflows = await loadOrderFlows(access, pendingOrderFlow.before?.id as string | undefined);
    context.pendingOrderflow = { action: pendingOrderFlow.action, id: pendingOrderFlow.before?.id ?? null, ...pendingOrderFlow.values };
  } else if (recoveredPlan?.orderDraft) {
    const draft = recoveredPlan.orderDraft;
    context.orderflows = await loadOrderFlows(access, draft.source?.id);
    context.pendingOrderflow = { action: draft.action, id: draft.source?.id ?? null,
      name: draft.name, steps: draft.steps, products: draft.products, scope: draft.scope };
  }
  if (validatedContext?.page === "workflows" && access.modules.includes("workflows")) context.workflow = await loadAssistantWorkflow(access);
  if (pendingWorkflow) {
    const card = await loadAssistantWorkflow(access);
    if (card.workspace.revision !== pendingWorkflow.before?.revision) throw new AssistantError("Rrjedha ndryshoi. Përgatite propozimin përsëri.");
    context.workflow = { ...card, workspace: { ...card.workspace, graph: pendingWorkflow.values.graph }, pendingDraft: true };
  } else if (recoveredPlan?.visualDraft) {
    const card = await loadAssistantWorkflow(access);
    if (card.workspace.revision !== recoveredPlan.visualDraft.revision) throw new AssistantError("Rrjedha ndryshoi. Rishqyrto draftin në editor.");
    context.workflow = { ...card, workspace: { ...card.workspace, graph: recoveredPlan.visualDraft.graph }, pendingDraft: true };
  }
  if (access.modules.includes("workflows") && access.modules.includes("products") && (pendingLinear || recoveredPlan?.linearDraft || ["products","workflows"].includes(validatedContext?.page??""))) {
    context.linear=await loadLinearContext(access,pendingLinear?.id??recoveredPlan?.linearDraft?.productId??(validatedContext?.entityType==="product"?validatedContext.entityId:null));
    if(pendingLinear) {
      const card=context.linear as LinearCard;
      if((card.draft?.revision??0)!==pendingLinear.before?.revision) throw new AssistantError("Drafti ndryshoi. Rifillo propozimin.");
      context.linear={...card,pendingDefinition:pendingLinear.values.definition};
    } else if (recoveredPlan?.linearDraft) {
      context.linear = { ...context.linear as LinearCard, pendingDefinition: recoveredPlan.linearDraft.definition };
    }
  }
  const timezone = access.modules.includes("bookings")
    ? await timezoneFor(access.businessId)
    : defaultSettings.timezone;
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 45_000,
    maxRetries: 0,
  });
  let workflowRepairs = 0;
  const repairWorkflow = (diagnostic: string, rejected: unknown) => {
    if (workflowRepairs >= 2) throw new AssistantError("Nuk arrita të përgatis një ndryshim të vlefshëm pas korrigjimit automatik. Asgjë nuk u ruajt. Mund të vazhdojmë nga i njëjti propozim duke sqaruar rezultatin e dëshiruar.");
    workflowRepairs++;
    context.workflowRepair = { diagnostic, rejected, instruction: "Correct this proposal against the original loaded graph; do not execute it." };
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    const flowId = validatedContext?.workflowSelection?.flowId;
    const loadedGraph = (context.workflow as WorkflowCard | undefined)?.workspace.graph;
    if (flowId && loadedGraph && (loadedGraph.version !== 2 || !loadedGraph.flows.some(flow => flow.id === flowId)))
      throw new AssistantError("Rrjedha e zgjedhur nuk ekziston më. Zgjidhe përsëri në editor.");
    let proposal: Proposal;
    let rawProposal: unknown;
    try {
      const response = await client.responses.create({
        model: modelFor("assistant"),
        store: false,
        max_output_tokens: 9000,
        instructions: OWNER_ASSISTANT_PROMPT(access.modules, access.catalogSource === "external"),
        input: JSON.stringify({
          assistant: { name: readPersonalAssistantName(assistantName) ?? defaultPersonalAssistantName },
          now: new Date().toISOString(),
          timezone,
          data: context,
          uiContext: validatedContext ? {...validatedContext, selectedEntity: selected} : undefined,
          history,
          request: text,
          materials: materials.map(m => /\.csv$/i.test(m.name) ? { ...m, text: m.text.slice(0, 2000), note: "CSV excerpt for routing only. product_import reads the complete file and compares the full catalog." } : m),
          attemptsRemaining: 4 - attempt,
        }),
        text: {
          format: {
            type: "json_schema",
            name: "business_action",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["action", "id", "message", "changes", "choices", "automation", "planRelation"],
              properties: {
                planRelation: { type: ["string", "null"], enum: ["continue", "new", null] },
                automation: context.workflowRepair ? { ...automationIntentSchema, type: "object" } : automationIntentSchema,
                choices: {type:"array",items:{type:"string"}},
                action: { type: "string", enum: actions.filter(action =>
                  (!context.workflowRepair || action === "workflow_draft" || action === "clarify") &&
                  (!context.configurationRepair || action === "configuration_apply" || action === "clarify") &&
                  !["product_create", "product_update", "service_create", "service_update", "knowledge_create", "knowledge_update", "agent_update"].includes(action) &&
                  !(action === "orderflow_load" && context.orderflows) &&
                  !(action === "workflow_load" && context.workflow) &&
                  !(attempt >= 4 && ["search","workflow_load","orderflow_load","linear_load"].includes(action))) },
                id: { type: ["string", "null"] },
                message: { type: "string" },
                changes: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["field", "value"],
                    properties: {
                      field: { type: "string" },
                      value: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      });
      rawProposal = JSON.parse(response.output_text);
      proposal = readProposal(rawProposal);
      proposal.requestedText = text;
    } catch (e) {
      if (rawProposal && typeof rawProposal === "object" && (rawProposal as { action?: unknown }).action === "workflow_draft" && e instanceof AssistantError) {
        repairWorkflow(e.message, rawProposal);
        continue;
      }
      if (e instanceof AssistantError) throw e;
      throw new AssistantError(
        "Kërkesa nuk u analizua. Provo përsëri ose jep më shumë hollësi.",
      );
    }
    const finish = (result: PlanResult): PlanResult => ({ ...result, ...(proposal.planRelation === "new" ? { replacePlan: true } : {}) });
    if (proposal.action === "configuration_resume") {
      const id = proposal.changes.find(c=>c.field === "plan_id")?.value;
      if (!id || proposal.id !== null) throw new AssistantError("Zgjidh konfigurimin që dëshiron të vazhdosh.");
      const plan = await loadConfigurationPlan(access.businessId,access.userId,id,access.accessToken);
      const review = await reviewConfigurationRequest(text,history,plan.steps.map(s=>s.definition),{...context,configuration:plan.steps.map(s=>s.definition),originalRequest:plan.steps[0].authority.request});
      await renewConfigurationPlan(access.businessId,access.userId,plan,review,access.accessToken);
      const result=await executeConfigurationPlan(access.businessId,access.userId,id,access.accessToken);
      return finish({message:result.message,configuration:result,saved:true,replacePlan:true,
        outcome:{status:result.state,action:"configuration_apply",reference:{table:"business_operation_plans",id}}});
    }
    if (proposal.action === "configuration_apply") {
      const raw = proposal.changes.find(c => c.field === "steps")?.value;
      if (!raw || proposal.id !== null) throw new AssistantError("Mungojnë hapat e konfigurimit.");
      let steps: ReturnType<typeof parseConfigurationSteps>;
      try { steps = parseConfigurationSteps(JSON.parse(raw)); }
      catch (error) {
        if (attempt >= 3) throw new AssistantError("Plani i konfigurimit nuk kaloi validimin. Nuk u ndryshua biznesi.");
        context.configurationRepair = {rejected:raw, diagnostic:error instanceof OperationError ? error.message : "Invalid configuration structure", instruction:"Repair this same plan. References may contain only id:{step:priorZeroBasedIndex,output:'id'}, must target a preceding creation of the same entity type, must include that index in after, and must omit input.id. Omit references entirely when unused. Do not invent business facts or change scope. No effects have executed."};
        continue;
      }
      for (const step of steps) if (step.key === "workflow.configure") step.input.request = text;
      const review = await reviewConfigurationRequest(text, history, steps, context);
      const plan = await prepareConfigurationPlan(access.businessId, access.userId, steps, review, access.accessToken);
      const result = await executeConfigurationPlan(access.businessId, access.userId, plan.id, access.accessToken);
      return finish({ message: [result.message,review.remainingQuestion].filter(Boolean).join("\n\n"), configuration: result, saved: true, replacePlan: true,
        outcome: {status: result.state, action: "configuration_apply", reference: {table: "business_operation_plans", id: plan.id}} });
    }
    if (proposal.action === "automation_plan") {
      const automation = await buildAutomationProposal({ mode: "plan", businessId: access.businessId, userId: access.userId,
        request: text, intent: proposal.automation });
      const actionPlan = toActionPlan(automation, text, proposal.automation!.clarificationQuestions);
      // Do not echo model-authored claims of readiness/success or issue a mutation ticket.
      return { actionPlan, message: "Ja plani për shqyrtim. Kontrollo gatishmërinë e secilit hap më poshtë. Asgjë nuk është ruajtur, aktivizuar ose publikuar." };
    }
    if (proposal.action === "clarify" && proposal.automation && access.modules.includes("workflows")) {
      const card = (context.workflow as WorkflowCard | undefined) ?? await loadAssistantWorkflow(access);
      const automation = await buildAutomationProposal({ businessId: access.businessId, userId: access.userId,
        revision: card.workspace.revision, publishedVersionId: card.workspace.publishedVersionId,
        request: text, intent: proposal.automation, before: card.workspace.graph, after: card.workspace.graph, operations: [] });
      return finish({ message: automationMessage(automation), automation, clarifying: true, workflow: { ...card, simulation: simulateAutomation(card.workspace.graph, card.workspace.graph, automation), semanticSummary: summarizeWorkflowChanges(card.workspace.graph, card.workspace.graph, card.workspace.revision, card.workspace.publishedVersionId, automation) } });
    }
    if (proposal.action === "product_import") {
      assertEnabled(access, proposal.action);
      const csvs = materials.filter(m => /\.csv$/i.test(m.name));
      if (csvs.length !== 1) return finish({ message: "Ngarko një CSV për vlerësim dhe miratim në grup.", clarifying: true });
      try {
        const source = await openImportSource(access, csvs[0].text, csvs[0].name);
        if (proposal.changes.length) {
          const selected = JSON.parse(proposal.changes[0].value);
          if (!Array.isArray(selected) || !selected.length || selected.some(f => !importFields.includes(f))) throw Error("Fusha importi të pavlefshme.");
          source.fields = [...new Set(selected)] as ImportField[];
        }
        return finish({ message: "Skedari është gati për vlerësim. Para ruajtjes do të shohësh ndryshimet për miratim.", productImport: source }); }
      catch (e) { throw new AssistantError((e as Error).message); }
    }
    if (proposal.action.startsWith("orderflow_")) {
      assertEnabled(access, proposal.action);
      if (proposal.action === "orderflow_load" || (!context.orderflows && proposal.action !== "orderflow_read")) {
        context.orderflows = await loadOrderFlows(access, proposal.id);
        continue;
      }
      const source = (context.orderflows as OrderFlowContext | undefined)?.flows.find(flow => flow.id === proposal.id);
      if (["orderflow_update","orderflow_assign"].includes(proposal.action) && !source) {
        context.orderflows = await loadOrderFlows(access, proposal.id);
        continue;
      }
      if (pendingOrderFlow && !["orderflow_load","orderflow_read"].includes(proposal.action)) {
        proposal = refineOrderFlowProposal(pendingOrderFlow, proposal);
        return finish(await prepareOrderFlow(access, proposal, pendingOrderFlow.before as unknown as import("./orderflow-service").OrderFlow | undefined));
      }
      return finish(await prepareOrderFlow(access, proposal, source));
    }
    if (proposal.action.startsWith("linear_")) {
      assertEnabled(access,proposal.action);
      if (validatedContext?.workflowSelection?.dirty && !["linear_load","linear_read"].includes(proposal.action)) throw new AssistantError("Ruaj ndryshimet e editorit para ndryshimit të workflow-t.");
      if (proposal.action==="linear_load" || !context.linear || (proposal.id && (context.linear as LinearCard).productId!==proposal.id)) {
        context.linear=await loadLinearContext(access,proposal.id);continue;
      }
      if((pendingLinear || recoveredPlan?.linearDraft) && proposal.action==="linear_publish") throw new AssistantError("Ruaj propozimin si draft para publikimit.");
      return finish(await prepareLinear(access,proposal,context.linear as LinearCard));
    }
    if (proposal.action.startsWith("workflow_")) {
      assertEnabled(access, proposal.action);
      if (!["workflow_load", "workflow_read", "workflow_catalog"].includes(proposal.action) && validatedContext?.workflowSelection?.dirty) throw new AssistantError("Ke ndryshime të paruajtura në editor. Ruaji para se Agjenti të ndryshojë rrjedhën.");
      if (proposal.action === "workflow_load" || (!context.workflow && !["workflow_read", "workflow_catalog"].includes(proposal.action))) {
        context.workflow = await loadAssistantWorkflow(access);
        continue;
      }
      if (proposal.action === "workflow_draft") {
        if (!proposal.automation) {
          repairWorkflow("workflow_draft requires a non-null automation object with requestedBehaviors, assumptions and clarificationQuestions.", proposal);
          continue;
        }
        try {
          const base = (context.workflow as WorkflowCard).workspace.graph;
          const candidate = applyWorkflowOperations(base, proposal.changes.find(change => change.field === "operations")?.value ?? "", text);
          const problems = workflowProblems(candidate);
          // An intentionally empty reset is a draft, never publishable. All actual
          // processes must have valid wiring before offering the owner's review.
          const emptyReset = candidate.version === 2 && !candidate.flows.length && (() => { const ops = JSON.parse(proposal.changes.find(change => change.field === "operations")?.value ?? "[]"); return ops.length === 1 && ops[0].op === "reset"; })();
          if (problems.length && !emptyReset) {
            repairWorkflow("Correct the reported node IDs and ports. Rewrite the full operations against the original graph, not the invalid candidate. Remove unreachable unused nodes or reconnect them; do not repeat the same invalid patch.", { proposal, candidate, validation: validateVisualGraph(candidate).errors });
            continue;
          }
        } catch (error) {
          if (!(error instanceof WorkflowProposalError)) throw error;
          repairWorkflow(error.message, proposal);
          continue;
        }
      }
      const pendingGraph = pendingWorkflow?.values.graph ?? recoveredPlan?.visualDraft?.graph;
      // Publish a pending candidate through the same draft writer first. Its
      // identity, scope and current request are independently reviewed below.
      if (pendingGraph && proposal.action === "workflow_publish") proposal = { ...proposal, action: "workflow_draft", changes: [] };
      return finish(await applyRequestedWorkflow(access, proposal, text, history, (context.workflow as WorkflowCard | undefined)?.workspace.revision, pendingGraph));
    }
    if (proposal.action === "search") {
      context.searchResult = await searchContext(access, proposal);
      continue;
    }
    if (selectedProducts.length && !["clarify", "operation", "operation_plan", "operation_resume"].includes(proposal.action)) return { message: "Për ndryshimet e produkteve zgjidh një produkt. Një workflow mund ta lidhësh me disa produkte njëherësh." };
    let expected: Row | undefined;
    if (proposal.action.endsWith("_update")) {
      const kind = proposal.action.split("_")[0];
      const initial = context[kind] as { rows: Row[] } | undefined;
      const searched = context.searchResult as
        | { kind: string; rows: Row[] }
        | undefined;
      expected = [
        ...(searched?.kind === kind ? searched.rows : []),
        ...(initial?.rows ?? []),
      ].find(
        (row) =>
          row.id === (kind === "profile" ? access.businessId : proposal.id),
      );
      if (!expected)
        throw new AssistantError(
          "Elementi nuk u identifikua qartë. Specifiko emrin e saktë.",
        );
    }
    if (proposal.action === "operation" && proposal.changes.find(c => c.field === "key")?.value === "product.remove") {
      if (!access.modules.includes("products")) throw new AssistantError("Produktet nuk janë aktivë në këtë biznes.");
      const change = proposal.changes.find(c => c.field === "input");
      if (change) {
        const input = JSON.parse(change.value);
        if (input.scope === "listed") {
          if (validatedContext?.page !== "products") throw new AssistantError("Hap katalogun ose përcakto produktet që dëshiron të heqësh.");
          change.value = JSON.stringify({ scope: "listed", query: validatedContext.searchQuery ?? "", status: validatedContext.filters?.status ?? "all" });
        }
      }
    }
    return finish(await prepareProposal(access, proposal, timezone, expected));
  }
  return {
    message:
      "Nuk arrita ta përcaktoj veprimin. Më trego emrin e rrjedhës ose elementit dhe ndryshimin që dëshiron.",
  };
}
export async function prepareProposal(
  access: Access,
  p: Proposal,
  timezone: string,
  expected?: Row,
): Promise<PlanResult> {
  p = readProposal(p);
  assertEnabled(access, p.action);
  // Normalize old planner vocabulary at preparation, while already-issued
  // tickets retain their reviewed semantics until their short expiry.
  if (p.action === "agent_update") {
    if (p.changes.length !== 1 || p.changes[0].field !== "instructions")
      throw new AssistantError("Ndryshimi i komunikimit kërkon udhëzimet e agjentit.");
    p = { action: "operation", id: null, message: "Shqyrto draftin e komunikimit. Publikimi bëhet veçmas.", changes: [
      { field: "key", value: "agent.communication" },
      { field: "input", value: JSON.stringify({ id: p.id, mode: "draft", instructions: p.changes[0].value }) },
    ] };
  }
  if (p.action === "clarify") return { clarifying: true, message: p.message, ...(p.choices?.length?{choices:p.choices}:{}) };
  if(p.action.startsWith("linear_")) return prepareLinear(access,p);
  if (p.action.startsWith("orderflow_")) return prepareOrderFlow(access, p);
  if (p.action.startsWith("workflow_")) return prepareWorkflow(access, p, expected?.revision as number | undefined);
  if (p.action === "operation_plan" || p.action === "operation_resume") {
    const fields = Object.fromEntries(p.changes.map(change => [change.field, change.value]));
    const plan = p.action === "operation_resume"
      ? await resumeOperationPlan(access.businessId, access.userId, fields.plan_id, access.accessToken)
      : await prepareOperationPlan(access.businessId, access.userId, JSON.parse(fields.steps), access.accessToken);
    const ticket: Ticket = { purpose: "business-assistant-v1", businessId: access.businessId, userId: access.userId, action: p.action,
      id: plan.id, expires: Date.now() + 600000, before: null, values: { plan } };
    return { message: p.message, preview: plan.preview, token: encryptSecret(JSON.stringify(ticket)) };
  }
  if (p.action === "operation") {
    const changes = Object.fromEntries(p.changes.map(change => [change.field, change.value]));
    let input: unknown;
    try { input = JSON.parse(changes.input); } catch { throw new AssistantError("Mungojnë të dhënat e veprimit."); }
    const operation = await prepareOperation(access.businessId, access.userId, changes.key, input, access.accessToken);
    if (operation.key === "agent.communication" && expected
      && (operation.snapshot.before as Row)?.updated_at !== expected.updated_at)
      throw new AssistantError("Të dhënat ndryshuan gjatë analizës. Provo kërkesën përsëri.");
    const ticket: Ticket = { purpose: "business-assistant-v1", businessId: access.businessId, userId: access.userId,
      action: "operation", id: operation.requestId, expires: Date.now() + 10 * 60000, before: null, values: { operation } };
    return { message: operation.key === "product.remove" ? `${operation.preview.title}: ${operation.preview.subject}. Shqyrto listën dhe konfirmo. Asgjë nuk është ndryshuar ende.` : p.message,
      preview: operation.preview, token: encryptSecret(JSON.stringify(ticket)), ...(operation.key === "product.remove" ? { replacePlan: true } : {}) };
  }
  const kind = p.action.split("_")[0];
  const before = p.action.endsWith("_update")
    ? await loadRow(access, kind, p.id ?? access.businessId)
    : null;
  if (
    expected &&
    before &&
    (expected.updated_at !== before.updated_at ||
      expected.revision !== before.revision ||
      (kind === "agent" && expected.instructions !== before.instructions))
  )
    throw new AssistantError(
      "Të dhënat ndryshuan gjatë analizës. Provo kërkesën përsëri.",
    );
  let inputBefore = before;
  if (kind === "booking" && before)
    inputBefore = {
      ...before,
      ...zonedParts(String(before.starts_at), timezone),
    };
  const values = valuesFor(p, inputBefore, timezone);
  if (p.action === "service_create") values.is_active = false;
  let serviceName: string | undefined;
  let serviceVersion: Ticket["serviceVersion"];
  if (kind === "booking" || kind === "availability") {
    const service = await loadRow(access, "service", String(values.service_id));
    if (
      values.status !== "cancelled" &&
      (!service.is_active || !service.booking_enabled)
    )
      throw new AssistantError("Ky shërbim nuk është aktiv për rezervime.");
    serviceName = String(service.name);
    serviceVersion = {
      id: String(service.id),
      updatedAt: String(service.updated_at),
    };
    if (kind === "booking")
      values.ends_at = new Date(
        Date.parse(String(values.starts_at)) +
          Number(service.duration_minutes) * 60000,
      ).toISOString();
    if (kind === "availability") {
      let slots;
      try {
        slots = await availableSlots(
          access.businessId,
          String(values.service_id),
          String(values.date),
        );
      } catch (e) {
        throw new AssistantError((e as Error).message);
      }
      return {
        message: slots.length
          ? `Oraret e lira për ${serviceName}, më ${values.date} (${timezone}). Më thuaj orën, emrin dhe kontaktin për të përgatitur takimin.`
          : `Nuk ka orare të lira për ${serviceName} më ${values.date}.`,
        slots: slots.map((s) => zonedParts(s.start, timezone).time),
      };
    }
    // The booking RPC and Google integration check availability again on save, including when rescheduling.
    if (kind === "booking" && values.status !== "cancelled") {
      const date = zonedParts(String(values.starts_at), timezone).date;
      let slots;
      try {
        slots = await availableSlots(
          access.businessId,
          String(values.service_id),
          date,
          before ? String(before.id) : undefined,
        );
      } catch (e) {
        throw new AssistantError((e as Error).message);
      }
      if (
        !slots.some(
          (s) => Date.parse(s.start) === Date.parse(String(values.starts_at)),
        )
      )
        throw new AssistantError(
          "Ora e kërkuar nuk është e lirë. Kërko oraret e lira për këtë ditë.",
        );
    }
  }
  const preview = previewFor(p.action, before, values, timezone, serviceName);
  if (!preview.fields.length)
    return {
      message: "Të dhënat janë tashmë siç i kërkove. Nuk nevojitet ndryshim.",
    };
  const ticket: Ticket = {
    purpose: "business-assistant-v1",
    userId: access.userId,
    businessId: access.businessId,
    expires: Date.now() + 10 * 60000,
    action: p.action,
    id: before ? String(before.id) : randomUUID(),
    before,
    values,
    serviceVersion,
  };
  return {
    message: p.message,
    preview,
    token: encryptSecret(JSON.stringify(ticket)),
  };
}
export async function executeTicket(access: Access, token: string) {
  const t = openTicket(token, access);
  if (t.action === "operation_plan" || t.action === "operation_resume") return executeOperationPlan(access.businessId, access.userId, t.values.plan as PreparedPlan, access.accessToken);
  if (t.action === "operation") return executeOperation(access.businessId, access.userId, t.values.operation as PreparedOperation, access.accessToken);
  if(t.action === "product_create" || t.action === "service_create") await requireActionAccess(access.businessId,access.userId,t.action === "product_create" ? "product.create" : "service.create");
  if (t.action.startsWith("orderflow_")) return executeOrderFlow(access, t);
  if (t.action.startsWith("workflow_")) return executeWorkflow(access, t);
  if(t.action.startsWith("linear_")) return executeLinear(access,t);
  const kind = t.action.split("_")[0];
  if (kind === "agent") {
    try { await requireAgentConfigurationAccess(access.businessId, access.userId); }
    catch { throw new AssistantError("Nuk ke më qasje për të ndryshuar agjentin në këtë biznes."); }
  }
  if (kind === "booking") {
    const v = t.values;
    if (t.serviceVersion) {
      const service = await loadRow(access, "service", t.serviceVersion.id);
      if (service.updated_at !== t.serviceVersion.updatedAt)
        throw new AssistantError(
          "Shërbimi ka ndryshuar. Përgatite takimin përsëri.",
        );
    }
    try {
      const result = await persistBooking(access.businessId, {
        ...(t.before
          ? { id: t.id, revision: Number(t.before.revision) }
          : { requestKey: `assistant:${t.id}` }),
        serviceId: String(v.service_id),
        name: String(v.customer_name),
        contact: String(v.customer_contact),
        start: String(v.starts_at),
        status: v.status as "pending" | "confirmed" | "cancelled",
        notes: String(v.notes),
      });
      return {
        message: result.syncError
          ? "Takimi u ruajt, por sinkronizimi me Google Calendar nuk përfundoi. Kontrollo kalendarin; mos e krijo sërish."
          : "Takimi u ruajt.",
        path: "bookings",
      };
    } catch (e) {
      throw new AssistantError((e as Error).message);
    }
  }
  const db = createServiceSupabase();
  if (t.before) {
    let query = db
      .from(tables[kind])
      .update({ ...t.values, updated_at: kind === "agent"
        ? new Date(Math.max(Date.now(), (Date.parse(String(t.before.updated_at)) || 0) + 1)).toISOString()
        : new Date().toISOString() })
      .eq("id", t.id)
      .eq("updated_at", t.before.updated_at);
    if (kind === "agent")
      query = query.eq("instructions", t.before.instructions);
    if (kind === "profile") query = query.eq("id", access.businessId);
    else query = query.eq("business_id", access.businessId);
    const result = await query.select("id").maybeSingle();
    if (result.error)
      throw new AssistantError(
        "Ndryshimi nuk u ruajt. Kontrollo të dhënat dhe provo përsëri.",
      );
    if (!result.data)
      throw new AssistantError(
        "Të dhënat kanë ndryshuar që nga përgatitja. Analizo kërkesën përsëri.",
      );
  } else {
    const result = await db
      .from(tables[kind])
      .insert({ ...t.values, id: t.id, business_id: access.businessId });
    if (result.error) {
      // A repeated confirmation can only acknowledge this exact tenant-owned generated ID.
      if (result.error.code !== "23505")
        throw new AssistantError("Elementi nuk u ruajt. Provo përsëri.");
      const previous = await db
        .from(tables[kind])
        .select("id")
        .eq("business_id", access.businessId)
        .eq("id", t.id)
        .maybeSingle();
      if (!previous.data || previous.error)
        throw new AssistantError(
          "Ekziston një element me këto të dhëna. Kontrolloje para krijimit.",
        );
    }
  }
  const configurationEffect: AgentConfigurationEffect | undefined = kind === "agent"
    ? await observeAgentEffect(access.businessId, t.id, String(t.values.instructions)) : undefined;
  return {
    ...(configurationEffect ? { configurationEffect } : {}),
    message: configurationEffect ? configurationEffectMessage(configurationEffect) : "Ndryshimet u ruajtën.",
    path: kind === "profile" ? "settings" : moduleFor(t.action),
  };
}
