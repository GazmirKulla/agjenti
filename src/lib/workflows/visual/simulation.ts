import { initialSnapshot, type Field, type ProcessDefinition, type Instance, type CustomerCommand } from "@/lib/orchestration/contracts";
import { transitionCustomer, recordPresentation, type Environment } from "@/lib/orchestration/transition";
import { validFieldValue } from "@/lib/orchestration/definition";
import { compileVisualProcesses, visualNodeForStep } from "@/lib/orchestration/visual-definition";
import { normalizeVisualDraft, validateVisualGraph } from "./model";
import { visualGraphHash } from "./graph-hash";
import { generateSimulationScenarios, syntheticValue, type Scenario } from "./simulation-scenarios";
import type { VisualGraph, VisualVersion, VisualNode } from "./types";
import type { SimulationBinding, SimulationReport, ScenarioResult, SimulationStatus } from "./simulation-types";
import { getCapability, type CapabilityAssessment } from "@/lib/capabilities/registry";
import { capabilityFinding, readinessFinding } from "@/lib/capabilities/diagnostics";
import { nodeCapabilityKeys } from "@/lib/capabilities/graph";

const externalActions = new Set(["action", "knowledge", "product", "booking", "order_status", "handoff"]);
const limits = { scenarios: 192, turns: 40, durationMs: 2000 };
const redacted = "[vlerë sintetike / konfigurimi e fshehur]";
const expectedLabels = {
  complete: "Rruga përfundon duke përdorur vetëm hapa lokalë.",
  suspend: "Kërkohet përsëri informacioni, pa ruajtur përgjigjen e paqartë ose bosh.",
  branch: "Ekzekutohet dalja e përcaktuar nga lidhja Po/Jo në graf.",
  collect: "Vlera sintetike e vlefshme mblidhet në fushën përkatëse.",
  existing: "Vlera ekzistuese ruhet dhe ndiqet lidhja pas hapit të mbledhjes.",
  regression: "Gjurmët, fushat dhe përgjigjet lokale përputhen me versionin para ndryshimit.",
};

function emptyResult(s: Scenario): ScenarioResult {
  return { scenarioId: s.id, description: s.description, category: s.category, critical: true,
    inputMessages: [s.message], initialState: { nodeId: s.nodeId ?? null, awaiting: s.awaiting ?? false, intent: s.intent,
      values: Object.fromEntries(Object.keys(s.values ?? {}).map(key => [key, redacted])) },
    expectedOutcome: expectedLabels[s.expectation.kind] + (s.expectation.port ? ` ${s.expectation.port === "yes" ? "Po" : "Jo"} → ${s.expectation.target ?? "mungon lidhja"}.` : ""), actualOutcome: "Nuk u ekzekutua.", traversedNodeIds: [], selectedBranches: {},
    collectedFields: [], attemptedActions: [], validationFindings: [], executionCount: 0, durationMs: 0, result: "UNVERIFIED" };
}

/** Synthetic observations exercise the production compiler and transition engine.
 * No model, executor, transport or persistence is accepted by this adapter. */
function executeScenario(graph: VisualGraph, s: Scenario) {
  const started = performance.now(), result = emptyResult(s);
  const version: VisualVersion = { id: `simulation-${visualGraphHash(graph)}`, businessId: "simulation", graph, createdAt: "2026-01-01T00:00:00Z" };
  let state = initialSnapshot("simulation", "simulation", "test");
  let definition: ProcessDefinition | undefined;
  const responses: unknown[] = [];
  let external: VisualNode | undefined;
  const boundary = new Error("external_simulation_boundary");
  const values = () => Object.fromEntries(Object.entries(state.instances.simulation?.facts ?? {}).map(([key, fact]) => [key, fact.value]));
  const canonical = (field: Field, value: string) => field.type === "number" ? Number(value) : field.type === "photo" ? true : value;
  try {
    const definitions = compileVisualProcesses(version);
    const authored = graph.nodes.find(n => n.id === s.nodeId);
    definition = s.nodeId && authored?.kind !== "start" ? definitions.find(d => d.steps.some(step => step.id === s.nodeId)) : definitions.length === 1 ? definitions[0] : undefined;
    if (!definition) {
      result.category = "coverage";
      result.actualOutcome = "Zgjedhja e procesit ose hapi jashtë procesit kërkon provë semantike integrimi.";
      result.validationFindings.push(readinessFinding("hub_unverified", result.actualOutcome));
      return { result, evidence: "unverified_entry" };
    }
    const instance: Instance = { id: "simulation", definitionId: definition.id, versionId: definition.versionId,
      stepId: authored && authored.kind !== "start" ? authored.id : definition.entry,
      status: "suspended", suspendedStatus: "running", facts: {} };
    for (const [key, value] of Object.entries({ ...s.sharedValues, ...s.values })) {
      const field = definition.fields.find(f => f.id === key);
      if (!field || !validFieldValue(field, canonical(field, value))) throw new Error("invalid_fixture_field");
      instance.facts[key] = { fieldId: key, subject: field.subject, value: canonical(field, value), revision: 0, eventId: "fixture", evidence: "synthetic fixture" };
    }
    state.instances.simulation = instance; state.focusId = instance.id;
    const env: Environment = { mode: "test", now: 1000, promptTtlMs: 60000, definitions,
      startableVersionIds: new Set([version.id]), tools: [],
      onStep: step => {
        const nodeId = visualNodeForStep(version, step.stepId);
        const previous = graph.nodes.find(n => n.id === result.traversedNodeIds.at(-1));
        if (previous?.kind === "condition" || previous?.kind === "confirm") {
          const edge = graph.edges.find(e => e.source === previous.id && e.target === nodeId);
          if (edge?.port === "yes" || edge?.port === "no") result.selectedBranches[previous.id] = edge.port;
        }
        result.traversedNodeIds.push(nodeId);
        const node = graph.nodes.find(n => n.id === nodeId);
        if (node && externalActions.has(node.kind)) { external = node; throw boundary; }
      } };
    const step = (message: string, commands: CustomerCommand[], photo = false) => {
      const before = state.instances.simulation;
      const traceStart = result.traversedNodeIds.length;
      const predicates = { intent_order: "order", intent_booking: "booking", intent_support: "support" };
      const conditions = definition!.steps.flatMap(node => {
        if (node.kind !== "semantic_condition") return [];
        const operator = graph.nodes.find(n => n.id === node.id)?.config.condition;
        const intent = operator && Object.hasOwn(predicates, operator) ? predicates[operator as keyof typeof predicates] : undefined;
        return [{ definitionId: definition!.id, versionId: version.id, instanceId: "simulation", stepId: node.id,
          outcome: intent === s.intent ? "yes" as const : "no" as const, evidence: message }];
      });
      result.executionCount++;
      const transition = transitionCustomer(state, { id: `fixture-${result.executionCount}`, businessId: "simulation", conversationId: "simulation", actor: "customer", message },
        { revision: state.revision, commands, conditions, needsClarification: false }, { ...env, photoReceived: photo });
      state = transition.state;
      if (commands.some(c => c.kind === "approve" || c.kind === "decline")) {
        const destination = result.traversedNodeIds[traceStart];
        const edge = graph.edges.find(e => e.source === before.stepId && e.target === destination);
        if (edge?.port === "yes" || edge?.port === "no") result.selectedBranches[before.stepId] = edge.port;
      }
      responses.push(transition.notices.map(n => ({ kind: n.kind, text: n.text, field: n.field?.id })));
      state = recordPresentation(state, transition.notices.flatMap(n => n.targetId ? [n.targetId] : []), env.now);
    };
    // Seeded progress is explicit fixture data. Resume obtains a real native wait;
    // a cursor alone never becomes permission to accept a confirmation or photo.
    step("synthetic resume", [{ kind: "resume", instanceId: "simulation", evidence: "synthetic resume" }]);
    let initialAnswer = Boolean(s.awaiting);
    while (result.executionCount < limits.turns && (initialAnswer || s.followPrompts)) {
      const current = state.instances.simulation;
      if (!current.wait || current.status === "completed") break;
      const node = graph.nodes.find(n => n.id === current.stepId);
      if (!node) throw new Error("synthetic_prompt_unavailable");
      const message = initialAnswer ? s.message : node.kind === "confirm" ? "synthetic approval" : syntheticValue(node);
      const commands: CustomerCommand[] = [];
      const suspended = initialAnswer && s.expectation.kind === "suspend";
      if (!suspended && current.wait.kind === "approval") commands.push({ kind: initialAnswer && s.expectation.port === "no" ? "decline" : "approve",
        instanceId: current.id, waitId: current.wait.id, evidence: message });
      else if (!suspended && current.wait.kind === "field") {
        const field = definition.fields.find(f => f.id === current.wait!.fieldId)!;
        if (field.type !== "photo") commands.push({ kind: "facts", instanceId: current.id, values: [{ fieldId: field.id, value: canonical(field, message), evidence: message }] });
      }
      if (!initialAnswer) result.inputMessages.push(message);
      step(message, commands, !suspended && node.config.fieldType === "photo");
      initialAnswer = false;
      if (!s.followPrompts) break;
    }
    const current = state.instances.simulation, e = s.expectation;
    const node = graph.nodes.find(n => n.id === e.nodeId), field = definition.fields.find(f => f.id === node?.config.fieldKey);
    const matches = e.kind === "complete" || e.kind === "regression" ? current.status === "completed"
      : e.kind === "branch" ? result.selectedBranches[e.nodeId!] === e.port && result.traversedNodeIds.includes(e.target ?? "")
      : e.kind === "suspend" ? current.wait?.stepId === e.nodeId && JSON.stringify(values()) === JSON.stringify(s.values ?? {})
      : !!field && values()[field.id] === canonical(field, e.value!) && (e.kind !== "existing" || result.traversedNodeIds.includes(e.target ?? ""));
    result.result = matches ? "PASS" : "FAIL";
    result.actualOutcome = matches ? "Tranzicioni native përputhet me pritshmërinë strukturore." : "Tranzicioni native nuk përputhet me pritshmërinë strukturore.";
    if (!matches) result.validationFindings.push(readinessFinding("expectation_mismatch", result.actualOutcome));
  } catch (error) {
    if (error === boundary && external) {
      result.result = "UNVERIFIED";
      result.attemptedActions.push({ kind: external.kind, nodeId: external.id, disposition: "not_executed" });
      result.actualOutcome = "Motori native arriti te kufiri i shërbimit; veprimi nuk u ekzekutua.";
      for (const capabilityKey of nodeCapabilityKeys(external).length ? nodeCapabilityKeys(external) : [null])
        result.validationFindings.push(readinessFinding("external_action_not_executed", result.actualOutcome,
          { nodeId: external.id, capabilityKey, missingRequirements: ["isolated_execution_evidence"] }));
      if (s.expectation.kind === "branch" && result.selectedBranches[s.expectation.nodeId!] !== s.expectation.port) {
        result.result = "FAIL";
        result.validationFindings.push(readinessFinding("expectation_mismatch", "Dega e ekzekutuar nuk përputhet me pritshmërinë."));
      }
    } else {
      result.result = "FAIL"; result.actualOutcome = "Përpilimi ose tranzicioni native ndaloi me gabim.";
      result.validationFindings.push(readinessFinding("runtime_error", result.actualOutcome));
    }
  }
  result.collectedFields = graph.nodes.filter(n => n.config.fieldKey && Object.hasOwn(values(), n.config.fieldKey)).map(n => ({ nodeId: n.id, value: redacted }));
  result.durationMs = Math.round((performance.now() - started) * 100) / 100;
  return { result, evidence: JSON.stringify({ trace: result.traversedNodeIds, branches: result.selectedBranches, values: values(), responses }) };
}

function blockedScenario(code: string, message: string, result: SimulationStatus = "BLOCKED", nodeId?: string): ScenarioResult {
  const s = emptyResult({ id: code, description: message, category: "coverage", message: "", intent: "unknown", expectation: { kind: "complete" }, nodeId });
  return { ...s, inputMessages: [], result, validationFindings: [{ code, message, nodeId }] };
}

export function simulationBinding(report: SimulationReport): SimulationBinding {
  return { version: 3, proposalId: report.proposalId, baseRevision: report.baseRevision, candidateGraphHash: report.candidateGraphHash };
}
export function matchesSimulationBinding(binding: Omit<SimulationBinding, "version"> & { version: number }, proposalId: string, revision: number, raw: unknown): boolean {
  const graph = normalizeVisualDraft(raw);
  return !!graph && binding.version === 3 && binding.proposalId === proposalId && binding.baseRevision === revision && binding.candidateGraphHash === visualGraphHash(graph);
}

/** Synchronous, bounded, isolated execution against the SAME deterministic runtime used in production/Chat Lab. */
export function simulateWorkflowProposal(input: {
  proposalId: string; baseRevision: number; before: VisualGraph; candidate: VisualGraph;
  capabilities?: CapabilityAssessment[]; assessmentUnavailable?: boolean; clarificationRequired?: boolean;
}): SimulationReport {
  const started = performance.now();
  const graph = normalizeVisualDraft(input.candidate);
  const report: SimulationReport = { version: 3, engine: "process-runtime", proposalId: input.proposalId, baseRevision: input.baseRevision,
    candidateGraphHash: visualGraphHash(graph ?? input.candidate), baselineGraphHash: visualGraphHash(input.before),
    scenarios: [], validationFindings: [], durationMs: 0, result: "BLOCKED", canPublish: false };
  const validation = validateVisualGraph(input.candidate);
  const unknownConfiguration = input.candidate.nodes.some(n => Object.keys(n.config ?? {}).some(key => !["action", "prompt", "fieldKey", "fieldType", "condition", "value"].includes(key)));
  if (!graph || !validation.graph || unknownConfiguration) {
    for (const [index, error] of validation.errors.entries()) {
      report.scenarios.push(blockedScenario(`invalid_graph:${index}`, error.message, "BLOCKED", error.nodeId));
    }
    if (unknownConfiguration) report.scenarios.push(blockedScenario("unsupported_graph_action", "Grafi përmban konfigurim jashtë veprimeve të mbështetura."));
  } else {
    const scenarios = generateSimulationScenarios(input.before, graph);
    for (const scenario of scenarios.slice(0, limits.scenarios)) {
      if (performance.now() - started > limits.durationMs) {
        report.scenarios.push(blockedScenario("time_budget", "Prova tejkaloi kufirin kohor; mbulimi nuk është i plotë.", "UNVERIFIED")); break;
      }
      const run = executeScenario(graph, scenario);
      if (scenario.category === "regression") {
        const baseline = executeScenario(input.before, scenario);
        if (baseline.result.result !== "PASS") {
          run.result.result = "UNVERIFIED";
          run.result.validationFindings.push({ code: "baseline_unverified", message: "Sjellja bazë nuk u verifikua plotësisht; regresioni nuk mund të konfirmohet." });
        } else if (run.result.result === "PASS" && baseline.evidence !== run.evidence) {
          run.result.result = "FAIL";
          run.result.validationFindings.push({ code: "regression_changed", message: "Ekzekutimi ndryshoi në një rrugë të deklaruar të pandryshuar." });
        }
        run.result.actualOutcome = run.result.result === "PASS" ? "Ekzekutimet e versionit bazë dhe kandidatit përputhen." : "Regresioni nuk kaloi ose nuk mund të verifikohet.";
        run.result.durationMs += baseline.result.durationMs;
      }
      report.scenarios.push(run.result);
    }
    if (scenarios.length > limits.scenarios) report.scenarios.push(blockedScenario("scenario_budget", "Kufiri i skenarëve u tejkalua; mbulimi është i paplotë.", "UNVERIFIED"));
    if (graph.version === 2) report.scenarios.push(blockedScenario("hub_unverified", "Zgjedhja e procesit nga hub-i dhe lidhjet me katalogun kërkojnë provë integrimi. Këtu provohen rrugët lokale.", "UNVERIFIED"));
  }
  for (const capability of input.capabilities ?? []) if (capability.status !== "ready" || !getCapability(capability.capabilityKey)) {
    const unsupported = capability.status === "unsupported" || !getCapability(capability.capabilityKey);
    const finding = capabilityFinding(unsupported ? { ...capability, status: "unsupported" } : capability, graph ?? undefined);
    const entry = blockedScenario(finding.code, finding.message);
    entry.validationFindings = [finding];
    entry.scenarioId += `:${report.scenarios.length}`; entry.category = "capability"; report.scenarios.push(entry);
  }
  if (input.assessmentUnavailable) report.scenarios.push(blockedScenario("assessment_unavailable", "Vlerësimi i aftësive ose autorizimit nuk u konfirmua."));
  if (input.clarificationRequired) report.scenarios.push(blockedScenario("clarification_required", "Qëllimi i kërkuar ka paqartësi; sqarimi nuk zëvendësohet nga një provë teknike."));
  report.validationFindings = [{ code: "structural_scope", message: "Të dhëna sintetike, qëllime të paracaktuara dhe vetëm runtime determinist. Nuk provohen kuptimi nga AI, përmbajtja e përgjigjeve apo integrimet reale." }];
  for (const scenario of report.scenarios) scenario.validationFindings = scenario.validationFindings.map(f => readinessFinding(f.code, f.message, f));
  const statuses = report.scenarios.map(s => s.result);
  report.result = statuses.includes("FAIL") ? "FAIL" : statuses.includes("BLOCKED") ? "BLOCKED" : statuses.includes("UNVERIFIED") ? "UNVERIFIED" : statuses.length ? "PASS" : "UNVERIFIED";
  report.canPublish = report.scenarios.length > 0 && report.scenarios.every(s => !s.critical || s.result === "PASS" && s.executionCount > 0);
  report.durationMs = Math.round((performance.now() - started) * 100) / 100;
  return report;
}
