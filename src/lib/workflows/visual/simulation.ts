import { advanceVisualWorkflow } from "./runtime";
import { normalizeVisualDraft, validateVisualGraph } from "./model";
import { visualGraphHash } from "./graph-hash";
import { generateSimulationScenarios, syntheticValue, type Scenario } from "./simulation-scenarios";
import type { VisualExecution, VisualGraph, VisualRunState } from "./types";
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

/** No transports, providers, persistence or LLM callbacks are accepted by this adapter. */
function executeScenario(graph: VisualGraph, s: Scenario) {
  const started = performance.now(), result = emptyResult(s), versionId = `simulation:${visualGraphHash(graph)}`;
  let state: VisualRunState | undefined = s.nodeId ? { nodeId: s.nodeId, versionId, status: "running", awaiting: !!s.awaiting, visited: [], values: structuredClone(s.values ?? {}) } : undefined;
  let message = s.message, photo = !!s.photo, last: VisualExecution | undefined;
  const responseEvidence: string[] = [];
  try {
    for (let turn = 0; turn < limits.turns; turn++) {
      last = advanceVisualWorkflow({ graph, versionId, state, message, hasPhoto: photo, intent: s.intent, sharedValues: s.sharedValues });
      result.executionCount++;
      state = last.state;
      result.traversedNodeIds.push(...last.traversedNodeIds);
      result.selectedBranches = { ...state.branchPorts };
      // Compare actual prompt content for regression, but never return it to the caller/UI.
      responseEvidence.push(JSON.stringify([last.action.kind, last.action.nodeId, last.action.message]));
      if (externalActions.has(last.action.kind)) {
        result.attemptedActions.push({ kind: last.action.kind, nodeId: last.action.nodeId, disposition: "not_executed" });
        result.result = "UNVERIFIED";
        result.actualOutcome = "Runtime arriti te një shërbim real; veprimi nuk u krye.";
        const node = graph.nodes.find(n => n.id === last!.action.nodeId)!;
        for (const capabilityKey of nodeCapabilityKeys(node).length ? nodeCapabilityKeys(node) : [null])
          result.validationFindings.push(readinessFinding("external_action_not_executed", "Nuk u thirr shërbimi, AI, katalogu, rezervimi, porosia ose stafi. Rezultati i tyre mbetet i paverifikuar.",
            { nodeId: node.id, capabilityKey, missingRequirements: ["isolated_execution_evidence"], remediation: "Provo këtë veprim me adapter të izoluar dhe pritshmëri të pavarura. Mos përdor porosi ose mesazhe reale." }));
        break;
      }
      if (!s.followPrompts || last.action.kind === "end") break;
      const node = graph.nodes.find(n => n.id === last!.action.nodeId)!;
      message = node.kind === "confirm" ? "po" : syntheticValue(node);
      photo = node.config.fieldType === "photo";
      result.inputMessages.push(message);
    }
    if (last && !result.attemptedActions.length) {
      const e = s.expectation, node = graph.nodes.find(n => n.id === e.nodeId), key = node?.config.fieldKey;
      const matches = e.kind === "complete" || e.kind === "regression" ? last.action.kind === "end"
        : e.kind === "branch" ? state?.branchPorts?.[e.nodeId!] === e.port && result.traversedNodeIds[1] === e.target
        : e.kind === "suspend" ? last.action.kind === "prompt" && last.action.nodeId === e.nodeId && JSON.stringify(state?.values) === JSON.stringify(s.values ?? {})
        : e.kind === "collect" ? !!key && state?.values[key] === e.value
        : !!key && state?.values[key] === e.value && result.traversedNodeIds[1] === e.target;
      result.result = matches ? "PASS" : "FAIL";
      result.actualOutcome = matches ? "Ekzekutimi përputhet me pritshmërinë strukturore të këtij skenari." : "Ekzekutimi nuk përputhet me pritshmërinë strukturore.";
      if (!matches) result.validationFindings.push({ code: "expectation_mismatch", nodeId: last.action.nodeId, message: "Kontrollo rrugën e ndjekur dhe lidhjet e hapit. Nuk provohet rezultati i kërkuar." });
    }
  } catch {
    result.result = "FAIL"; result.actualOutcome = "Runtime ndaloi me gabim.";
    result.validationFindings.push({ code: "runtime_error", nodeId: state?.nodeId ?? s.nodeId, message: "Gabim gjatë ekzekutimit të rrugës; kontrollo lidhjet dhe kufirin e hapave." });
  }
  result.collectedFields = graph.nodes.filter(n => n.config.fieldKey && Object.hasOwn(state?.values ?? {}, n.config.fieldKey)).map(n => ({ nodeId: n.id, value: redacted }));
  result.durationMs = Math.round((performance.now() - started) * 100) / 100;
  // Internal-only evidence for before/after comparison. Never serialized into a report.
  const evidence = JSON.stringify({ trace: result.traversedNodeIds, branches: result.selectedBranches, values: state?.values, responses: responseEvidence });
  return { result, evidence };
}

function blockedScenario(code: string, message: string, result: SimulationStatus = "BLOCKED", nodeId?: string): ScenarioResult {
  const s = emptyResult({ id: code, description: message, category: "coverage", message: "", intent: "unknown", expectation: { kind: "complete" }, nodeId });
  return { ...s, inputMessages: [], result, validationFindings: [{ code, message, nodeId }] };
}

export function simulationBinding(report: SimulationReport): SimulationBinding {
  return { version: 1, proposalId: report.proposalId, baseRevision: report.baseRevision, candidateGraphHash: report.candidateGraphHash };
}
export function matchesSimulationBinding(binding: SimulationBinding, proposalId: string, revision: number, raw: unknown): boolean {
  const graph = normalizeVisualDraft(raw);
  return !!graph && binding.version === 1 && binding.proposalId === proposalId && binding.baseRevision === revision && binding.candidateGraphHash === visualGraphHash(graph);
}

/** Synchronous, bounded, isolated execution against the SAME deterministic runtime used in production/Chat Lab. */
export function simulateWorkflowProposal(input: {
  proposalId: string; baseRevision: number; before: VisualGraph; candidate: VisualGraph;
  capabilities?: CapabilityAssessment[]; assessmentUnavailable?: boolean; clarificationRequired?: boolean;
}): SimulationReport {
  const started = performance.now();
  const graph = normalizeVisualDraft(input.candidate);
  const report: SimulationReport = { version: 1, engine: "visual-runtime-v1", proposalId: input.proposalId, baseRevision: input.baseRevision,
    candidateGraphHash: visualGraphHash(graph ?? input.candidate), baselineGraphHash: visualGraphHash(input.before),
    scenarios: [], validationFindings: [], durationMs: 0, result: "BLOCKED", canPublish: false };
  const validation = validateVisualGraph(input.candidate);
  const unknownConfiguration = input.candidate.nodes.some(n => Object.keys(n.config ?? {}).some(key => !["prompt", "fieldKey", "fieldType", "condition", "value"].includes(key)));
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
