import { randomUUID } from "node:crypto";
import type { AgentTurnParams, AgentTurnResult } from "@/lib/conversations/process-agent-turn";
import { emptyState } from "@/lib/workflows/state";
import { loadVisualVersion } from "@/lib/workflows/visual/store";
import { createServiceSupabase } from "@/lib/supabase/service";
import { agentConfigurationColumns, configurationRead } from "@/lib/agents/configuration";
import { readBusinessGrounding } from "@/lib/agents/business-grounding";
import { runtimeModules, CapabilityEnforcementError } from "@/lib/capabilities/enforcement";
import { isIsolatedExecution, recordExternalAction, snapshotExternalActions } from "@/lib/runtime/execution-context";
import { agentModel } from "@/lib/agents/model";
import { initialSnapshot, TransitionError, type Snapshot, type ToolPolicy } from "./contracts";
import { compileVisualProcesses, UnsupportedProcessGraph, visualNodeForStep } from "./visual-definition";
import { interpretCustomer } from "./interpret";
import { recordPresentation, type Environment } from "./transition";
import { runProcessTurn } from "./run-turn";
import { businessProvisionAdapter } from "./business-provision";
import { processPreparedRequest } from "./prepared-request";
import { composeProcessReply } from "./respond";
import { bookingAdapter } from "./booking";
import { bookingContext } from "./booking-context";
import { bookingToolPolicy, bookingFields } from "./booking-definition";
import { availableSlots } from "@/lib/calendar/service";

/** Replacement integration during construction. A v4 session can never fall back into legacy parsing.
 * The old coordinator is temporary construction code, not a supported compatibility engine.
 * Live transport is connected; unsupported domains still require their adapters.
 */
export async function tryProcessConversation(params: AgentTurnParams): Promise<AgentTurnResult | null> {
  const existing = params.state?.runtime;
  const mode = params.mode === "test" && isIsolatedExecution() ? "test" : "live";
  const transport = mode === "live" ? params.processTransport : undefined;
  if (mode === "live" && !transport) {
    if (existing || params.mode === "test") throw new TransitionError("process_transport_cutover_required");
    return null;
  }
  if (params.linearPreview) {
    if (existing) throw new TransitionError("process_session_restart_required");
    return null;
  }
  const current = params.visualPreview ?? await loadVisualVersion(params.businessId);
  if (current && current.businessId !== params.businessId) throw new TransitionError("definition_scope_mismatch");
  const versions = new Map(current ? [[current.id, current]] : []);
  for (const versionId of new Set(Object.values(existing?.instances ?? {}).map(i => i.versionId).concat(Object.values(existing?.offers ?? {}).map(o => o.versionId)))) {
    if (!versions.has(versionId)) {
      const pinned = await loadVisualVersion(params.businessId, versionId);
      if (!pinned) throw new TransitionError("definition_unavailable");
      versions.set(versionId, pinned);
    }
  }
  let definitions;
  try { definitions = [...versions.values()].flatMap(compileVisualProcesses); }
  catch (error) {
    if (error instanceof UnsupportedProcessGraph && !existing) {
      params.onTrace?.({ stage: "workflow", label: "Process replacement pending for graph adapters", status: "skipped", data: { nodeIds: error.nodeIds, runtime: "legacy" } });
      return null;
    }
    throw error;
  }
  if (!existing && (params.state?.visual || params.state?.processes?.active || params.state?.product_id || Object.keys(params.state?.fields ?? {}).length)) throw new TransitionError("process_session_restart_required");
  if (existing && (existing.businessId !== params.businessId || existing.mode !== mode || transport && existing.conversationId !== transport.conversationId)) throw new TransitionError("event_scope_mismatch");
  const started = Date.now(), deadline = started + 38000;
  const trace = params.onTrace;
  trace?.({ stage: "overview", label: "Process runtime v4", data: { mode, businessId: params.businessId, versionIds: [...versions.keys()] } });
  const db = createServiceSupabase();
  const modules = await runtimeModules(params.businessId);
  if (definitions.length && modules && !modules.includes("workflows")) throw new CapabilityEnforcementError("module_disabled", "Workflow është çaktivizuar. Progresi yt është ruajtur.");
  const hasBookings = [...versions.values()].some(v => v.graph.nodes.some(n => n.kind === "booking"));
  const [agentRead, grounding, calendarRead] = await Promise.all([
    db.from("ai_agents").select(agentConfigurationColumns).eq("business_id", params.businessId).eq("is_active", true).maybeSingle(),
    readBusinessGrounding(db, params.businessId, modules),
    hasBookings ? db.from("business_calendar_settings").select("timezone").eq("business_id", params.businessId).maybeSingle() : { data: null, error: null },
  ]);
  if (agentRead.error) throw new Error("process_configuration_unavailable");
  const agent = params.configurationPreview ?? agentRead.data;
  const configuration = configurationRead(agent);
  trace?.({ stage: "context", label: "Agent configuration read", data: { ...configuration, businessId: params.businessId } });
  const context = {
    businessTimezone: !calendarRead.error ? calendarRead.data?.timezone ?? null : null,
    instructions: agent?.instructions ?? "", communication: agent?.communication,
    knowledge: { ...grounding.knowledge, records: grounding.knowledge.records.slice(0, 30).map(k => ({ ...k, body: k.body.slice(0, 3000) })),
      contextLimited: grounding.knowledge.records.length > 30 },
    products: { ...grounding.products, records: grounding.products.records.slice(0, 20), contextLimited: grounding.products.records.length > 20 },
    services: { ...grounding.services, records: grounding.services.records.slice(0, 20), contextLimited: grounding.services.records.length > 20 },
    attachments: params.attachmentContext,
  };
  trace?.({ stage: "tools", label: "Process business sources loaded", data: { knowledge: grounding.knowledge.status, products: grounding.products.status, services: grounding.services.status, readOnly: true } });
  const tools: ToolPolicy[] = [];
  const booking = bookingContext([...versions.values()]);
  if (hasBookings) tools.push(bookingToolPolicy(!modules || modules.includes("bookings") && modules.includes("services")));
  if (definitions.some(d => d.steps.some(s => s.kind === "effect" && s.tool === "business.provision"))) {
    const permission = await db.rpc("can_execute_business_action", { p_business: params.businessId, p_user: null, p_action: "business.provision", p_automated: true });
    tools.push({ key: "business.provision", version: 1, effect: "write", approval: "required", allowed: !permission.error && permission.data === true && !!current,
      inputs: [{ key: "name", type: "text", required: true, min: 2, max: 120 }, { key: "email", type: "email", required: true }, { key: "description", type: "text", required: false, max: 2000 }] });
  }
  const traversed: string[] = [];
  const env: Environment = { mode, now: Date.now(), definitions, startableVersionIds: new Set(current ? [current.id] : []), tools, promptTtlMs: 15 * 60000,
    serverFacts: booking.serverFacts, photoReceived: params.hasPhoto,
    onStep: step => {
      const version = versions.get(step.versionId);
      const editorNodeId = version ? visualNodeForStep(version, step.stepId) : step.stepId;
      traversed.push(editorNodeId);
      trace?.({ stage: "workflow", label: "Process step evaluated", data: { ...step, editorNodeId, businessId: params.businessId, executionMode: mode } });
    } };
  let state: Snapshot = existing ? structuredClone(existing) : { ...initialSnapshot(params.businessId, transport?.conversationId ?? randomUUID(), mode), revision: transport?.revision ?? 0 };
  if (hasBookings) await booking.prepare(state, definitions);
  const beforeRevision = state.revision;
  const history = params.state?.recentMessages?.length ? params.state.recentMessages : state.history ?? [];
  const event = { id: transport ? `job:${transport.jobId}:customer` : randomUUID(), businessId: params.businessId, conversationId: state.conversationId, message: params.message, actor: "customer" as const };
  const adapters = [businessProvisionAdapter(transport ? { businessId: params.businessId, conversationId: state.conversationId,
    lease: transport, versionForInstance: id => state.instances[id]?.versionId } : undefined),
    bookingAdapter(transport ? { businessId: params.businessId, conversationId: state.conversationId, lease: transport,
      definitionForInstance: id => state.instances[id] } : undefined)];
  const result = await runProcessTurn({ state, event, env, deadline, lease: transport, adapters,
    onState: currentState => { state = currentState; },
    validate: transition => {
      if (transition.notices.some(n => n.kind === "handoff") && modules && !modules.includes("staff")) throw new CapabilityEnforcementError("module_disabled", "Kalimi te stafi është çaktivizuar.");
    },
    interpret: async () => {
      const interpretation = await interpretCustomer({ message: params.message, state, env, history, deadline, businessContext: context });
      if (hasBookings) await booking.prepare(state, definitions, interpretation.observation);
      trace?.({ stage: "ai", label: "Process observation validated", data: { ...interpretation.observation, model: interpretation.model,
        responseId: interpretation.responseId, usage: { input_tokens: interpretation.inputTokens, output_tokens: interpretation.outputTokens } } });
      return interpretation.observation;
    },
  });
  state = result.state;
  const notices = result.notices;
  const handoff = notices.some(n => n.kind === "handoff");
  if (handoff && modules && !modules.includes("staff")) throw new CapabilityEnforcementError("module_disabled", "Kalimi te stafi është çaktivizuar.");
  if (handoff && mode === "test") recordExternalAction({ kind: "staff.handoff", disposition: "SIMULATED", detail: "process_runtime_no_staff_notification" });
  const availability: { instanceId: string; serviceId: string; date: string; starts: string[]; status: string }[] = [];
  if (hasBookings && mode === "live") {
    for (const instance of Object.values(state.instances).filter(i => i.id === state.focusId && (i.status === "waiting_input" || i.status === "waiting_approval"))) {
      const version = versions.get(instance.versionId);
      if (definitions.find(d => d.id === instance.definitionId && d.versionId === instance.versionId)?.collection) continue;
      for (const node of version?.graph.nodes.filter(n => n.kind === "booking") ?? []) {
        const { key } = bookingFields(node.id), serviceId = instance.facts[key("serviceId")]?.value, date = instance.facts[key("date")]?.value;
        if (typeof serviceId !== "string" || typeof date !== "string") continue;
        try {
          const slots = await availableSlots(params.businessId, serviceId, date);
          availability.push({ instanceId: instance.id, serviceId, date, starts: slots.slice(0, 12).map(s => s.start), status: slots.length > 12 ? "partial" : "complete" });
        } catch { availability.push({ instanceId: instance.id, serviceId, date, starts: [], status: "unverified" }); }
      }
    }
  }
  const composed = await composeProcessReply({ message: params.message, history, state, env, notices, context: { ...context, availability }, deadline });
  // The isolated session token is issued together with this reply. Live channels require the SQL delivery receipt.
  const expectedRevision = state.revision;
  delete state.pendingTurn;
  state.handoffRequested = handoff;
  if (mode === "test") state = recordPresentation(state, composed.targetIds, Date.now());
  else state.revision++;
  state.history = [...history, { role: "user" as const, content: params.message }, { role: "assistant" as const, content: composed.reply }].slice(-16);
  trace?.({ stage: "workflow", label: "Process checkpoint prepared", data: { eventId: event.id, previousRevision: beforeRevision, revision: state.revision,
    instances: Object.values(state.instances).map(i => ({ id: i.id, definitionId: i.definitionId, versionId: i.versionId, stepId: i.stepId, status: i.status, waitId: i.wait?.id })),
    presentedTargetIds: composed.targetIds, mode } });
  trace?.({ stage: "ai", label: "Process reply composed", data: { responseId: composed.responseId, usage: { input_tokens: composed.inputTokens, output_tokens: composed.outputTokens, total_tokens: composed.inputTokens + composed.outputTokens } } });
  const active = state.focusId ? state.instances[state.focusId] : Object.values(state.instances).at(-1);
  const definition = active ? definitions.find(d => d.id === active.definitionId && d.versionId === active.versionId) : undefined;
  const version = active ? versions.get(active.versionId) : current;
  const nextState = { ...emptyState(), runtime: state, step_key: active?.stepId ?? null,
    recentMessages: state.history };
  return { ...(active && definition && version ? { preparedRequest: processPreparedRequest(active, definition, version, Date.now()) } : {}), ...(transport ? { processCheckpoint: { event: { ...event, id: `job:${transport.jobId}:reply` }, expectedRevision, targetIds: composed.targetIds } } : {}), reply: composed.reply, nextState, previousResponseId: null, workflowId: null, productName: null,
    workflowProgress: definition?.fields.map(f => ({ key: f.id, label: f.label, kind: "text" as const,
      status: active?.facts[f.id] ? "done" as const : active?.wait?.fieldId === f.id ? "current" as const : "pending" as const,
      value: active?.facts[f.id] ? String(active.facts[f.id].value) : null })) ?? [],
    ...(active && version ? { visualWorkflow: { graph: version.graph, traversedNodeIds: traversed,
      state: { versionId: version.id, nodeId: visualNodeForStep(version, active.stepId), status: active.status === "completed" ? "completed" as const : active.status === "handoff" ? "handoff" as const : "waiting" as const,
        visited: [...new Set((active.visited ?? []).map(id => visualNodeForStep(version, id)))], values: Object.fromEntries(Object.values(active.facts).map(f => [f.fieldId, String(f.value)])), awaiting: !!active.wait } } } : {}),
    externalActions: snapshotExternalActions(),
    ...(handoff ? { handoff: true, advisoryHandoff: mode === "test" } : {}),
    debug: { model: agentModel(), source: "ai", fallbackReason: null, agentConfigured: !!agent?.instructions, knowledgeCount: grounding.knowledge.records.length,
      productCount: grounding.products.records.length, workflowSteps: definition?.steps.map(s => s.id) ?? [], elapsedMs: Date.now() - started },
  };
}
