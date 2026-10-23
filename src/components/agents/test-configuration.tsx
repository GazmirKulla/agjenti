import Link from "next/link";
import type { TestConfigurationProvenance } from "@/lib/agents/configuration-contract";

export function TestConfiguration({ configuration, slug, agentConfigured }: {
  configuration?: TestConfigurationProvenance; slug: string; agentConfigured: boolean;
}) {
  const noActive = configuration?.agents.some(a => a.fallbackReason === "no_active_agent");
  const baseUsed = configuration?.agents.some(a => a.fallbackInstructionsUsed === true);
  const emptyInstructions = configuration?.agents.some(a => a.fallbackReason === "empty_instructions");
  const responseFallback = configuration?.responseFallbackReason;
  return <section className="test-configuration" aria-label="Konfigurimi i provës">
    {(noActive || emptyInstructions || !configuration && !agentConfigured) && <p className="agent-test-notice" role="status">
      {noActive ? "Nuk ka agjent klientësh aktiv. " : emptyInstructions ? "Agjenti aktiv nuk ka udhëzime. " : "Nuk u konfirmuan udhëzime nga një agjent aktiv. "}
      {baseUsed ? "Kjo provë përdor udhëzimet bazë, jo udhëzimet e agjentit joaktiv. " : "Kjo përgjigje nuk verifikon udhëzimet e ruajtura. "}
      <Link href={`/b/${slug}/agents`}>Kontrollo agjentin →</Link>
    </p>}
    <details>
      <summary>Konfigurimi i përdorur në këtë provë</summary>
      <p>Vëzhgim i këtij turni, jo status live pas rifreskimit. Sjellja e kërkuar nuk është verifikuar automatikisht.</p>
      {!configuration?.agents.length ? <p>Identiteti/versioni i udhëzimeve nuk është i disponueshëm për këtë përgjigje.</p> : configuration.agents.map((agent, index) => <dl key={index}>
        <div><dt>Agjenti</dt><dd>{agent.agentName ?? "Pa agjent aktiv"}{agent.agentId && <small>{agent.agentId}</small>}</dd></div>
        <div><dt>Statusi gjatë leximit</dt><dd>{agent.active === true ? "Aktiv" : agent.active === false ? "Joaktiv" : "I padisponueshëm"}</dd></div>
        <div><dt>Versioni i udhëzimeve</dt><dd><code title={agent.instructionHash ?? undefined}>{agent.instructionHash?.slice(0, 12) ?? "I padisponueshëm"}</code></dd></div>
        <div><dt>Udhëzime bazë</dt><dd>{agent.fallbackInstructionsUsed === true ? "Po · mungojnë udhëzimet aktive" : agent.fallbackInstructionsUsed === false ? "Jo" : "Nuk u dërgua kërkesë gjenerimi"}</dd></div>
        <div><dt>Lexuar më</dt><dd>{agent.readAt}</dd></div>
      </dl>)}
      <dl>
        <div><dt>Workflow</dt><dd>{configuration?.workflow.mode === "draft" ? "Preview eksplicit i draftit" : configuration?.workflow.mode === "published" ? "Version i publikuar" : configuration?.workflow.mode === "pinned" ? "Version i fiksuar në këtë bisedë" : "I padisponueshëm"}</dd></div>
        <div><dt>Versioni</dt><dd>{configuration?.workflow.versionId ?? "I padisponueshëm"}</dd></div>
        <div><dt>Burimi i përgjigjes</dt><dd>{configuration?.responseSource === "ai" ? "AI — jo provë e përputhjes me kërkesën" : configuration?.responseSource === "fallback" ? "Përgjigje rezervë / workflow — jo verifikim sjelljeje" : "I padisponueshëm"}</dd></div>
        {responseFallback && <div><dt>Arsyeja e përgjigjes rezervë</dt><dd>{responseFallback === "provider_error" ? "Ofruesi AI nuk e përfundoi kërkesën." : responseFallback === "missing_api_key" ? "Integrimi AI nuk është konfiguruar." : "Rrjedhë ose përgjigje e kontrolluar nga sistemi; jo provë se modeli ndoqi udhëzimet."}</dd></div>}
      </dl>
    </details>
  </section>;
}
