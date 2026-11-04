export const DEFAULT_AGENT_MODEL = "gpt-5.6-luna";

export function agentModel(): string {
  return process.env.AGENT_MODEL?.trim() || DEFAULT_AGENT_MODEL;
}
