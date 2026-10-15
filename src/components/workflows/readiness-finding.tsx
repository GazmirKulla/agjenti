import type { ReadinessFinding } from "@/lib/capabilities/diagnostics";

export function ReadinessFindingView({ finding, onFocus }: { finding: ReadinessFinding; onFocus?: (nodeId: string) => void }) {
  const nodes = finding.affectedNodeIds ?? (finding.nodeId ? [finding.nodeId] : []);
  return <div className="simulation-warning">
    <p>{finding.message}</p>
    <dl>
      <div><dt>Capability</dt><dd><code>{finding.capabilityKey ?? "Kontroll i përgjithshëm"}</code></dd></div>
      <div><dt>Arsyeja</dt><dd><code>{finding.reasonCode ?? finding.code}</code></dd></div>
      {!!finding.missingRequirements?.length && <div><dt>Kërkesat që mungojnë</dt><dd>{finding.missingRequirements.join(", ")}</dd></div>}
      <div><dt>Hapat e prekur</dt><dd>{nodes.length ? nodes.map(id => onFocus ? <button key={id} type="button" onClick={() => onFocus(id)}>{id} ↗</button> : <code key={id}>{id} </code>) : "Gjithë propozimi / pa hap të veçantë"}</dd></div>
    </dl>
    {finding.remediation && <p>Si ta zgjidhësh: {finding.remediation}</p>}
  </div>;
}
