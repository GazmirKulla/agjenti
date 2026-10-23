import Link from "next/link";
import type { Preview } from "@/lib/business-assistant/model";
import type { AgentConfigurationEffect } from "@/lib/agents/configuration-contract";

export function AgentInstructionNotice({ preview, slug }: { preview: Preview; slug: string }) {
  return <div className="assistant-notice">
    <p>{preview.notice}</p>
    {preview.agentConfiguration && <Link href={`/b/${slug}/agents`}>Kontrollo aktivizimin te Agjentët →</Link>}
  </div>;
}

export function AgentEffectObservation({ effect }: { effect: AgentConfigurationEffect }) {
  return <p>Kontrolluar më {effect.checkedAt}. Ky është rezultati në çastin e ruajtjes, jo garanci për gjendjen pas ndryshimeve të tjera. Sjellja nuk është testuar.</p>;
}
