import { randomUUID } from "node:crypto";
import {
  TransitionError, type Action, type CustomerEvent, type Instance, type Observation,
  type ProcessDefinition, type RuntimeNotice, type Snapshot, type ToolPolicy, type Transition, type Wait, type FactInput,
} from "./contracts";
import { digest, validFieldValue, validateDefinition } from "./definition";

/** These capabilities and clocks come from the server, never from a model response. */
export type Environment = {
  mode: "live" | "test";
  now: number;
  definitions: ProcessDefinition[];
  startableVersionIds: ReadonlySet<string>;
  tools: ToolPolicy[];
  promptTtlMs: number;
  id?: () => string;
  /** Verified inbound attachment presence, never a model observation. */
  photoReceived?: boolean;
  onStep?: (step: { instanceId: string; definitionId: string; versionId: string; stepId: string; kind: string }) => void;
  serverFacts?: (definition: ProcessDefinition, instance: Instance) => Record<string, import("./contracts").Value>;
  bindDependencies?: (instance: Instance, eventId: string) => void;
  resolveDefinition?: (definition: ProcessDefinition, instance: Instance) => ProcessDefinition;
};
const closed = new Set<Instance["status"]>(["completed", "cancelled", "handoff", "failed"]);
function fail(code: string): never { throw new TransitionError(code); }
const nextId = (env: Environment) => (env.id ?? randomUUID)();
const factDigest = (instance: Instance, fields: string[]) => digest(fields.map(id => [id, instance.facts[id] ?? null]));
function assertPolicy(instance: Instance, definition: ProcessDefinition) {
  if (instance.policyKey !== definition.policyKey) fail("process_policy_changed");
}
export function definitionFor(state: Snapshot, instance: Pick<Instance, "definitionId" | "versionId">, env: Environment) {
  const found = env.definitions.find(d => d.id === instance.definitionId && d.versionId === instance.versionId && d.businessId === state.businessId);
  if (!found) fail("definition_unavailable");
  return "facts" in instance && env.resolveDefinition ? env.resolveDefinition(found, instance as Instance) : found;
}
function instanceFor(state: Snapshot, id: string) {
  return Object.hasOwn(state.instances, id) ? state.instances[id] : fail("unknown_instance");
}
function evidence(text: string, event: CustomerEvent) {
  // Literal provenance validation, not interpretation of the customer's language.
  if (typeof text !== "string" || !text.trim() || !event.message.includes(text)) fail("invalid_evidence");
}
function validateEnvironment(state: Snapshot, env: Environment) {
  if (state.mode !== env.mode) fail("execution_mode_mismatch");
  if (!Number.isFinite(env.now) || !Number.isFinite(env.promptTtlMs) || env.promptTtlMs < 1 || env.promptTtlMs > 30 * 86400000) fail("invalid_environment");
  const versions = new Set<string>();
  for (const definition of env.definitions) {
    validateDefinition(definition);
    const identity = digest([definition.id, definition.versionId]);
    if (definition.businessId !== state.businessId || versions.has(identity)) fail("invalid_definition_scope");
    versions.add(identity);
  }
  const policies = new Set<string>();
  for (const tool of env.tools) {
    const key = `${tool.key}:${tool.version}`;
    if (policies.has(key)) fail("duplicate_tool_policy");
    policies.add(key);
  }
}
function createWait(instance: Instance, kind: Wait["kind"], fields: string[], env: Environment, extra: Partial<Wait> = {}): Wait {
  return { id: nextId(env), instanceId: instance.id, stepId: instance.stepId, kind,
    factDigest: factDigest(instance, fields), expiresAt: env.now + env.promptTtlMs, ...extra };
}
function start(state: Snapshot, definitionId: string, versionId: string, env: Environment) {
  const definition = definitionFor(state, { definitionId, versionId }, env);
  if (!env.startableVersionIds.has(versionId)) fail("process_not_startable");
  const instance: Instance = { id: nextId(env), definitionId, versionId, stepId: definition.entry, status: "running", facts: {}, ...(definition.policyKey ? { policyKey: definition.policyKey } : {}) };
  if (Object.hasOwn(state.instances, instance.id)) fail("identity_collision");
  state.instances[instance.id] = instance;
  state.focusId = instance.id;
  return instance;
}
function applyFacts(state: Snapshot, instance: Instance, values: FactInput[], event: CustomerEvent, env: Environment) {
  const definition = definitionFor(state, instance, env);
  assertPolicy(instance, definition);
  const keys = new Set<string>();
  if (values.length > 64) fail("fact_budget_exceeded");
  for (const item of values) {
    evidence(item.evidence, event);
    const field = definition.fields.find(f => f.id === item.fieldId);
    if (!field || field.source === "server" || field.type === "photo" || keys.has(item.fieldId) || !validFieldValue(field, item.value)) fail("invalid_fact");
    keys.add(item.fieldId);
    if (digest(instance.facts[field.id]?.value ?? null) !== digest(item.value)) {
      if (Object.hasOwn(instance.facts, field.id)) {
        // Re-evaluate conditional paths after a correction. Never replay a past effect.
        if (instance.action) fail("correction_requires_new_instance");
        instance.stepId = definition.entry;
        instance.status = "running";
        delete instance.wait;
      }
      instance.facts[field.id] = { fieldId: field.id, subject: field.subject, value: item.value,
        revision: state.revision + 1, eventId: event.id, evidence: item.evidence };
      if (instance.skippedFields) delete instance.skippedFields[field.id];
      delete instance.approval;
      if (instance.wait?.kind === "approval") delete instance.wait;
    }
  }
  env.bindDependencies?.(instance, event.id);
}
function refreshServerFacts(state: Snapshot, instance: Instance, definition: ProcessDefinition, env: Environment, fieldIds: string[]) {
  const fields = definition.fields.filter(f => f.source === "server" && fieldIds.includes(f.id));
  if (!fields.length) return false;
  if (!env.serverFacts) fail("server_facts_unavailable");
  const values = env.serverFacts(definition, instance);
  let changed = false;
  for (const field of fields) {
    const value = values[field.id];
    if (value === undefined || !validFieldValue(field, value)) fail("server_facts_unavailable");
    if (digest(instance.facts[field.id]?.value ?? null) !== digest(value)) {
      instance.facts[field.id] = { value, subject: field.subject, fieldId: field.id, revision: state.revision + 1,
        eventId: `server:${definition.versionId}:${field.id}`, evidence: `server:${field.id}` };
      changed = true;
    }
  }
  return changed;
}
function toolFor(instance: Instance, env: Environment) {
  const action = instance.action ?? fail("missing_action");
  const policy = env.tools.find(t => t.key === action.tool && t.version === action.toolVersion);
  if (!policy?.allowed) fail("tool_unavailable");
  return policy;
}
function validateApproval(instance: Instance, fieldIds: string[], env: Environment) {
  const approval = instance.approval;
  if (!approval || approval.expiresAt <= env.now || approval.factDigest !== factDigest(instance, approval.fieldIds)
    || fieldIds.some(id => !approval.fieldIds.includes(id))) fail("approval_required");
  return approval;
}
function advance(state: Snapshot, instance: Instance, env: Environment, notices: RuntimeNotice[], actions: Action[], condition?: (instance: Instance, stepId: string) => "yes" | "no") {
  if (closed.has(instance.status) || instance.status === "suspended" || instance.status === "waiting_effect") return;
  const definition = definitionFor(state, instance, env);
  assertPolicy(instance, definition);
  for (let transitions = 0; transitions < 128; transitions++) {
    const step = definition.steps.find(s => s.id === instance.stepId) ?? fail("unknown_step");
    instance.visited ??= [];
    if (!instance.visited.includes(step.id)) instance.visited.push(step.id);
    env.onStep?.({ instanceId: instance.id, definitionId: definition.id, versionId: definition.versionId, stepId: step.id, kind: step.kind });
    switch (step.kind) {
      case "collect": {
        const field = definition.fields.find(f => f.id === step.fieldId)!;
        if (Object.hasOwn(instance.facts, field.id) || !field.required && Object.hasOwn(instance.skippedFields ?? {}, field.id)) { instance.stepId = step.next; delete instance.wait; break; }
        if (instance.wait?.stepId !== step.id || instance.wait.expiresAt <= env.now) instance.wait = createWait(instance, "field", [field.id], env, { fieldId: field.id });
        instance.status = "waiting_input";
        notices.push({ kind: "question", instanceId: instance.id, targetId: instance.wait.id, field, text: step.prompt });
        return;
      }
      case "condition": {
        const value = instance.facts[step.fieldId]?.value;
        const matches = step.operator === "present" ? value !== undefined : digest(value ?? null) === digest(step.value);
        instance.stepId = matches ? step.yes : step.no;
        delete instance.wait;
        break;
      }
      case "semantic_condition": {
        if (!condition) fail("semantic_condition_unresolved");
        instance.stepId = condition(instance, step.id) === "yes" ? step.yes : step.no;
        delete instance.wait;
        break;
      }
      case "confirm": {
        refreshServerFacts(state, instance, definition, env, step.fieldIds);
        if ((step.requiredFieldIds ?? step.fieldIds).some(id => definition.fields.find(f => f.id === id)!.required && !Object.hasOwn(instance.facts, id))) fail("missing_review_fields");
        const currentDigest = factDigest(instance, step.fieldIds);
        if (instance.wait?.stepId !== step.id || instance.wait.factDigest !== currentDigest || instance.wait.expiresAt <= env.now) {
          instance.wait = createWait(instance, "approval", step.fieldIds, env);
          delete instance.approval;
        }
        instance.status = "waiting_approval";
        notices.push({ kind: "approval", instanceId: instance.id, targetId: instance.wait.id, text: step.label });
        return;
      }
      case "effect": {
        const policy = env.tools.find(t => t.key === step.tool && t.version === step.toolVersion);
        if (!policy?.allowed) {
          instance.lastError = "tool_unavailable";
          instance.status = "failed";
          notices.push({ kind: "blocked", instanceId: instance.id, reason: instance.lastError });
          return;
        }
        const input = Object.fromEntries(Object.entries(step.inputs).flatMap(([key, fieldId]) => {
          const fact = instance.facts[fieldId];
          return fact ? [[key, fact.value]] : [];
        }));
        if (Object.keys(input).some(key => !policy.inputs.some(p => p.key === key)) || policy.inputs.some(p => {
          const value = input[p.key];
          return value === undefined ? p.required : !validFieldValue({ ...p, id: p.key, label: p.key, subject: "input" }, value);
        })) fail("invalid_tool_input");
        const approval = policy.approval === "required" ? validateApproval(instance, Object.values(step.inputs), env) : undefined;
        const action: Action = { id: nextId(env), instanceId: instance.id, stepId: step.id, tool: step.tool, toolVersion: step.toolVersion,
          input, inputDigest: digest(input), status: "prepared", ...(approval ? { approvalWaitId: approval.waitId, approval: structuredClone(approval) } : {}) };
        instance.action = action;
        instance.status = "waiting_effect";
        delete instance.wait;
        delete instance.approval;
        actions.push(action);
        return;
      }
      case "inform":
        instance.stepId = step.next;
        delete instance.wait;
        break;
      case "resolve":
        refreshServerFacts(state, instance, definition, env, step.fieldIds);
        instance.stepId = step.next;
        delete instance.wait;
        break;
      case "message":
        notices.push({ kind: "message", instanceId: instance.id, text: step.text });
        instance.stepId = step.next;
        delete instance.wait;
        break;
      case "wait":
        if (instance.wait?.stepId !== step.id) instance.wait = createWait(instance, "event", [], env, { eventType: step.eventType, expiresAt: env.now + step.timeoutMs });
        instance.status = "waiting_event";
        return;
      case "end": case "handoff":
        instance.status = step.kind === "end" ? "completed" : "handoff";
        delete instance.wait;
        delete instance.approval;
        notices.push({ kind: step.kind === "end" ? "completed" : "handoff", instanceId: instance.id, text: step.label });
        if (state.focusId === instance.id) state.focusId = null;
        return;
    }
    instance.status = "running";
  }
  fail("transition_budget_exceeded");
}

function advanceAfterReceipt(state: Snapshot, instance: Instance, env: Environment, notices: RuntimeNotice[], actions: Action[]) {
  try { advance(state, instance, env, notices, actions); }
  catch (error) {
    if (!(error instanceof TransitionError)) throw error;
    // An already-confirmed effect/event must remain durable even if its next step is invalid.
    instance.status = "failed";
    instance.lastError = error.code;
    delete instance.wait;
    delete instance.approval;
    notices.splice(0, notices.length, { kind: "blocked", instanceId: instance.id, reason: error.code });
    actions.splice(0);
  }
}

/** Pure, atomic transition: callers persist the entire result with revision CAS and event deduplication. */
export function transitionCustomer(snapshot: Snapshot, event: CustomerEvent, observation: Observation, env: Environment): Transition {
  if (event.actor !== "customer" || event.businessId !== snapshot.businessId || event.conversationId !== snapshot.conversationId) fail("event_scope_mismatch");
  if (observation.revision !== snapshot.revision) fail("stale_observation");
  validateEnvironment(snapshot, env);
  if (observation.commands.length > 32) fail("command_budget_exceeded");
  const state = structuredClone(snapshot);
  const notices: RuntimeNotice[] = [];
  const actions: Action[] = [];
  const touched = new Set<string>();
  const conditionKeys = new Set<string>();
  for (const decision of observation.conditions ?? []) {
    evidence(decision.evidence, event);
    const definition = definitionFor(snapshot, decision, env);
    if (!definition.steps.some(s => s.id === decision.stepId && s.kind === "semantic_condition")) fail("invalid_condition_target");
    if (decision.instanceId !== null) {
      const instance = instanceFor(snapshot, decision.instanceId);
      if (instance.definitionId !== decision.definitionId || instance.versionId !== decision.versionId) fail("invalid_condition_target");
    }
    const key = digest([decision.definitionId, decision.versionId, decision.instanceId, decision.stepId]);
    if (conditionKeys.has(key)) fail("conflicting_condition_decisions");
    conditionKeys.add(key);
  }
  // Ambiguity never grants permission, even if a model also supplies an action command.
  if (observation.needsClarification) {
    if (observation.commands.length) fail("ambiguous_commands");
    notices.push({ kind: "clarify" });
  }
  const controls = new Set<string>();
  const approvalTargets = new Set(observation.commands.flatMap(c => c.kind === "approve" ? [c.instanceId] : []));
  if (observation.commands.some(c => c.kind === "facts" && approvalTargets.has(c.instanceId))) fail("approval_with_fact_changes");
  const updatedFields = new Set<string>();
  for (const command of observation.commands) if (command.kind === "facts") {
    for (const item of command.values) {
      const key = digest([command.instanceId, item.fieldId]);
      if (updatedFields.has(key)) fail("conflicting_field_updates");
      updatedFields.add(key);
    }
  }
  for (const command of observation.commands) {
    if (command.kind === "facts") command.values.forEach(v => evidence(v.evidence, event));
    else evidence(command.evidence, event);
    if (command.kind === "start") {
      const instance = start(state, command.definitionId, command.versionId, env);
      applyFacts(state, instance, command.initialFacts, event, env);
      touched.add(instance.id);
      continue;
    }
    if (command.kind === "offer") {
      definitionFor(state, command, env);
      if (!env.startableVersionIds.has(command.versionId)) fail("process_not_startable");
      const offer = Object.values(state.offers).find(o => o.definitionId === command.definitionId && o.versionId === command.versionId && o.expiresAt > env.now)
        ?? { id: nextId(env), definitionId: command.definitionId, versionId: command.versionId, expiresAt: env.now + env.promptTtlMs };
      state.offers[offer.id] = offer;
      notices.push({ kind: "offer", targetId: offer.id });
      continue;
    }
    if (command.kind === "accept_offer" || command.kind === "decline_offer") {
      const offer = Object.hasOwn(state.offers, command.offerId) ? state.offers[command.offerId] : undefined;
      if (!offer || offer.presentedAt === undefined || offer.presentedAt > env.now || offer.expiresAt <= env.now) fail("offer_not_presented_or_expired");
      if (command.kind === "accept_offer") {
        const instance = start(state, offer.definitionId, offer.versionId, env);
        applyFacts(state, instance, command.initialFacts, event, env);
        touched.add(instance.id);
      }
      delete state.offers[command.offerId];
      continue;
    }
    const instance = instanceFor(state, command.instanceId);
    const definition = definitionFor(state, instance, env);
    if (command.kind !== "cancel") assertPolicy(instance, definition);
    if (closed.has(instance.status) || instance.status === "waiting_effect") fail("instance_not_editable");
    touched.add(instance.id);
    if (command.kind === "facts") {
      if (instance.status === "suspended" || instance.status === "waiting_event" || !command.values.length || command.values.length > 64) fail("facts_not_expected");
      applyFacts(state, instance, command.values, event, env);
      continue;
    }
    if (controls.has(instance.id)) fail("conflicting_instance_commands");
    controls.add(instance.id);
    if (command.kind === "approve" || command.kind === "decline") {
      const wait = instance.wait;
      const step = definition.steps.find(s => s.id === instance.stepId);
      if (instance.status !== "waiting_approval" || !wait || wait.id !== command.waitId || wait.kind !== "approval"
        || wait.presentedAt === undefined || wait.presentedAt > env.now || wait.expiresAt <= env.now
        || step?.kind !== "confirm" || wait.factDigest !== factDigest(instance, step.fieldIds)) fail("invalid_approval_target");
      if (command.kind === "approve" && refreshServerFacts(state, instance, definition, env, step.fieldIds)) {
        delete instance.wait; delete instance.approval;
        notices.push({ kind: "message", instanceId: instance.id, reason: "review_terms_changed", text: "The business terms changed. Review the current details before proceeding." });
        continue;
      }
      if (command.kind === "approve") {
        instance.approval = { waitId: wait.id, stepId: step.id, fieldIds: [...step.fieldIds], factDigest: wait.factDigest, eventId: event.id, expiresAt: wait.expiresAt };
        instance.confirmedReviews = [...(instance.confirmedReviews ?? []), structuredClone(instance.approval)];
      }
      else delete instance.approval;
      instance.stepId = command.kind === "approve" ? step.yes : step.no;
      instance.status = "running";
      delete instance.wait;
    } else if (command.kind === "skip_field") {
      const wait = instance.wait;
      const step = definition.steps.find(s => s.id === instance.stepId);
      if (instance.status !== "waiting_input" || step?.kind !== "collect" || !wait || wait.id !== command.waitId || wait.kind !== "field"
        || wait.presentedAt === undefined || wait.presentedAt > env.now || wait.expiresAt <= env.now
        || definition.fields.find(f => f.id === step.fieldId)!.required || Object.hasOwn(instance.facts, step.fieldId)) fail("field_not_skippable");
      instance.skippedFields ??= {};
      instance.skippedFields[step.fieldId] = { eventId: event.id, evidence: command.evidence };
      instance.stepId = step.next;
      instance.status = "running";
      delete instance.wait;
    } else if (command.kind === "cancel") {
      instance.status = "cancelled";
      delete instance.wait;
      delete instance.approval;
      if (state.focusId === instance.id) state.focusId = null;
    } else if (command.kind === "suspend") {
      if (instance.status === "suspended") fail("already_suspended");
      instance.suspendedStatus = instance.status;
      instance.status = "suspended";
      delete instance.approval;
      if (state.focusId === instance.id) state.focusId = null;
    } else if (command.kind === "resume") {
      if (instance.status !== "suspended") fail("not_suspended");
      instance.status = instance.suspendedStatus ?? "running";
      delete instance.suspendedStatus;
      state.focusId = instance.id;
    }
  }
  // Only an already-presented, unambiguous photo prompt can consume an attachment.
  const photoTargets = Object.values(snapshot.instances).filter(i => i.status === "waiting_input" && i.wait?.kind === "field"
    && i.wait.presentedAt !== undefined && i.wait.presentedAt <= env.now && i.wait.expiresAt > env.now
    && definitionFor(snapshot, i, env).fields.find(f => f.id === i.wait?.fieldId)?.type === "photo");
  if (env.photoReceived && photoTargets.length === 1) {
    const original = photoTargets[0], instance = state.instances[original.id];
    if (instance.status === "waiting_input" && instance.wait?.id === original.wait!.id) {
      const definition = definitionFor(state, instance, env); assertPolicy(instance, definition);
      const field = definition.fields.find(f => f.id === instance.wait!.fieldId)!;
      instance.facts[field.id] = { value: true, subject: field.subject, fieldId: field.id, revision: state.revision + 1, eventId: event.id, evidence: `attachment:${event.id}` };
      touched.add(instance.id);
    }
  }
  for (const id of touched) advance(state, instanceFor(state, id), env, notices, actions, (instance, stepId) => {
    const decision = observation.conditions?.find(c => c.definitionId === instance.definitionId && c.versionId === instance.versionId
      && c.stepId === stepId && c.instanceId === (Object.hasOwn(snapshot.instances, instance.id) ? instance.id : null));
    if (!decision || decision.outcome === "unclear") fail("semantic_condition_unresolved");
    return decision.outcome;
  });
  state.revision++;
  return { state, notices, actions };
}

/** Called only with targets from a persisted reply whose transport receipt was verified. */
export function recordPresentation(snapshot: Snapshot, targetIds: string[], now: number): Snapshot {
  const state = structuredClone(snapshot);
  let changed = false;
  if (!Number.isFinite(now)) fail("invalid_clock");
  for (const id of targetIds) {
    const offer = Object.hasOwn(state.offers, id) ? state.offers[id] : undefined;
    const target = offer ?? Object.values(state.instances).map(i => i.wait).find(w => w?.id === id && w.kind !== "event");
    if (!target || target.expiresAt <= now) continue; // Late receipt for a replaced/expired target.
    if (target.presentedAt === undefined) { target.presentedAt = now; changed = true; }
  }
  if (changed) state.revision++;
  return state;
}

/** Revalidate immediately before a durable executor claims the prepared action. */
export function authorizeDispatch(snapshot: Snapshot, instanceId: string, actionId: string, env: Environment): Action {
  validateEnvironment(snapshot, env);
  const instance = instanceFor(snapshot, instanceId);
  assertPolicy(instance, definitionFor(snapshot, instance, env));
  const action = instance.action;
  if (instance.status !== "waiting_effect" || !action || action.id !== actionId || action.status !== "prepared") fail("action_not_dispatchable");
  const policy = toolFor(instance, env);
  const step = definitionFor(snapshot, instance, env).steps.find(s => s.id === instance.stepId);
  if (step?.kind !== "effect" || step.id !== action.stepId || step.tool !== action.tool || step.toolVersion !== action.toolVersion) fail("action_step_mismatch");
  if (action.inputDigest !== digest(action.input)) fail("action_input_changed");
  if (policy.approval === "required") {
    if (!action.approval || action.approval.expiresAt <= env.now || action.approval.factDigest !== factDigest(instance, action.approval.fieldIds)) fail("approval_required");
  }
  return structuredClone(action);
}

/** Persist this claim before invoking an adapter. A repeated claim cannot dispatch twice. */
export function transitionActionDispatch(snapshot: Snapshot, instanceId: string, actionId: string, env: Environment): Snapshot {
  authorizeDispatch(snapshot, instanceId, actionId, env);
  const state = structuredClone(snapshot);
  state.instances[instanceId].action!.status = "running";
  state.revision++;
  return state;
}

/** Receipt identity/status must be verified by the server executor before entering this function. */
export function transitionActionResult(snapshot: Snapshot, receipt: {
  instanceId: string; actionId: string; status: "succeeded" | "simulated" | "failed" | "unknown";
  output: NonNullable<Action["output"]>;
}, env: Environment): Transition {
  validateEnvironment(snapshot, env);
  const state = structuredClone(snapshot);
  const instance = instanceFor(state, receipt.instanceId);
  const action = instance.action;
  if (instance.status !== "waiting_effect" || !action || action.id !== receipt.actionId || !new Set(["prepared", "running", "unknown"]).has(action.status)) fail("unexpected_action_receipt");
  const step = definitionFor(state, instance, env).steps.find(s => s.id === instance.stepId);
  if (step?.kind !== "effect" || action.stepId !== step.id) fail("action_step_mismatch");
  if (receipt.status === "simulated" && env.mode !== "test") fail("simulation_in_live_mode");
  action.status = receipt.status;
  action.output = structuredClone(receipt.output);
  instance.results ??= {};
  instance.results[action.stepId] = { actionId: action.id, tool: action.tool, status: receipt.status, output: structuredClone(receipt.output) };
  const notices: RuntimeNotice[] = [];
  const actions: Action[] = [];
  if (receipt.status === "unknown") notices.push({ kind: "blocked", instanceId: instance.id, reason: "action_result_unknown" });
  else {
    instance.stepId = receipt.status === "failed" ? step.failed : step.next;
    instance.status = "running";
    advanceAfterReceipt(state, instance, env, notices, actions);
  }
  state.revision++;
  return { state, notices, actions };
}

/** Correlation comes from a server-owned subscription or timer, never from customer prose. */
export function transitionWaitEvent(snapshot: Snapshot, target: { instanceId: string; waitId: string; eventType: string }, env: Environment): Transition {
  validateEnvironment(snapshot, env);
  const state = structuredClone(snapshot);
  const instance = instanceFor(state, target.instanceId);
  const wait = instance.wait;
  const step = definitionFor(state, instance, env).steps.find(s => s.id === instance.stepId);
  if (instance.status !== "waiting_event" || !wait || wait.id !== target.waitId || wait.eventType !== target.eventType || step?.kind !== "wait") fail("unexpected_wait_event");
  instance.stepId = wait.expiresAt <= env.now ? step.expired : step.next;
  instance.status = "running";
  delete instance.wait;
  const notices: RuntimeNotice[] = [];
  const actions: Action[] = [];
  advanceAfterReceipt(state, instance, env, notices, actions);
  state.revision++;
  return { state, notices, actions };
}
