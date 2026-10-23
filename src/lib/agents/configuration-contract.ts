/** Observations, not authorization. No prompts or credentials belong in these receipts. */
export type AgentConfigurationEffect = {
  saved: true;
  effective: boolean | null;
  status: "effective" | "inactive" | "superseded" | "unverified";
  targetAgentId: string;
  targetActive: boolean | null;
  activeAgentId: string | null;
  instructionHash: string;
  checkedAt: string;
  behaviorVerified: false;
};

export type AgentConfigurationRead = {
  agentId: string | null;
  agentName: string | null;
  active: boolean | null;
  instructionHash: string | null;
  readAt: string;
  instructionSource: "active_agent" | "base";
  fallbackReason: "no_active_agent" | "empty_instructions" | null;
};

export type TestConfigurationProvenance = {
  /** One entry per actual context read; composed replies may read more than once. */
  agents: (AgentConfigurationRead & { generationRequested: boolean; fallbackInstructionsUsed: boolean | null })[];
  workflow: { id: string | null; versionId: string | null; mode: "draft" | "published" | "pinned" | "unavailable" };
  responseSource: "ai" | "fallback" | "unavailable";
  responseFallbackReason: string | null;
  behaviorVerified: false;
};

export const instructionGuidanceNotice = "Udhëzimet ndikojnë përgjigjen e AI-së; nuk garantojnë tekst identik. Një përgjigje e saktë automatike kërkon një rregull të mbështetur; kjo ruajtje nuk krijon ose publikon një të tillë.";

export function configurationEffectMessage(effect: AgentConfigurationEffect) {
  if (effect.status === "inactive") return "Udhëzimet u ruajtën. Agjenti i klientëve është joaktiv, prandaj këto udhëzime nuk përdoren ende.";
  if (effect.status === "effective") return "Udhëzimet u ruajtën dhe janë të disponueshme për përgjigjet e reja të agjentit. Sjellja nuk është testuar ende.";
  if (effect.status === "superseded") return "Udhëzimet u ruajtën, por konfigurimi efektiv është tjetër ose ka ndryshuar. Kontrollo agjentin aktiv përpara provës. Sjellja nuk është testuar.";
  return "Udhëzimet u ruajtën, por efektiviteti nuk u verifikua. Kontrollo konfigurimin; mos e përsërit ruajtjen vetëm për këtë arsye. Sjellja nuk është testuar.";
}
