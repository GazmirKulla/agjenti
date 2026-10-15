"use client";
import type { SimulationReport } from "@/lib/workflows/visual/simulation-types";
import { ReadinessFindingView } from "./readiness-finding";
import "./workflow-simulation-review.css";

export function WorkflowSimulationReview({ report, onFocus }: { report: SimulationReport; onFocus?: (nodeId: string) => void }) {
  const counts = (status: string) => report.scenarios.filter(s => s.result === status).length;
  return <section className="workflow-simulation" aria-label="Simulimi automatik">
    <header><h3>Prova automatike · {report.result}</h3>
      <p>{report.canPublish ? "Skenarët lokalë kaluan. Kjo nuk garanton sjelljen e AI ose integrimet reale." : "Jo plotësisht i validuar. Publikimi nga asistenti kërkon kalimin e të gjithë skenarëve kritikë."}</p>
      <p>{counts("PASS")} kaluan · {counts("FAIL")} dështuan · {counts("BLOCKED")} të bllokuar · {counts("UNVERIFIED")} të paverifikuar</p>
      <small>Revisioni {report.baseRevision} · {report.durationMs} ms · të dhëna sintetike, pa veprime reale</small>
    </header>
    {report.validationFindings.map((finding, i) => <p key={i}>{finding.message}</p>)}
    <div className="simulation-scenarios">{report.scenarios.map(scenario => <details key={scenario.scenarioId} data-result={scenario.result}>
      <summary>{scenario.result} · {scenario.description}</summary>
      <dl><div><dt>Pritshmëria</dt><dd>{scenario.expectedOutcome}</dd></div><div><dt>Ekzekutimi</dt><dd>{scenario.actualOutcome}</dd></div></dl>
      <p>{scenario.executionCount} thirrje të runtime · {scenario.durationMs} ms · {scenario.critical ? "kritik" : "informues"}</p>
      {!scenario.executionCount ? <p>Nuk u ekzekutua — nuk është test i dështuar.</p> : scenario.result === "FAIL" ? <p>U ekzekutua dhe dështoi.</p> : scenario.result === "UNVERIFIED" ? <p>Ekzekutim i pjesshëm; rezultati përfundimtar nuk u verifikua.</p> : null}
      <p>Hyrja: {scenario.inputMessages.filter(Boolean).join(" → ") || "Pa mesazh"}. Gjendja fillestare: {scenario.initialState.nodeId ?? "hyrja e rrjedhës"}; qëllimi: {scenario.initialState.intent}; {Object.keys(scenario.initialState.values).length} vlera të izoluara.</p>
      <p>Hapat e ndjekur:</p><div className="simulation-trace">{scenario.traversedNodeIds.length ? scenario.traversedNodeIds.map((id, i) => onFocus
        ? <button key={i} type="button" onClick={() => onFocus(id)} aria-label={`Fokuso hapin ${id}`}>{id} ↗</button> : <code key={i}>{id}</code>) : <span>Nuk ka gjurmë ekzekutimi.</span>}</div>
      {Object.keys(scenario.selectedBranches).length > 0 && <p>Rrugët: {Object.entries(scenario.selectedBranches).map(([id, port]) => `${id}: ${port === "yes" ? "Po" : "Jo"}`).join(" · ")}</p>}
      {scenario.collectedFields.length > 0 && <p>Fusha të mbledhura te hapat: {scenario.collectedFields.map(f => f.nodeId).join(", ")}. Vlerat janë të fshehura.</p>}
      {scenario.attemptedActions.map((action, i) => <p key={i}>Nuk u ekzekutua: {action.kind} · {action.nodeId}. Nuk u thirr asnjë shërbim real.</p>)}
      {scenario.validationFindings.map((finding, i) => <ReadinessFindingView key={i} finding={finding} onFocus={onFocus} />)}
    </details>)}</div>
    <details><summary>Identiteti i provës</summary><p>Propozimi: {report.proposalId}</p><p>Grafi: <code>{report.candidateGraphHash}</code></p><p>Motori: {report.engine}. Asnjë miratim, ruajtje ose publikim nuk u krye nga kjo provë.</p></details>
  </section>;
}
