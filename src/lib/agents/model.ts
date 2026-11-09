export const DEFAULT_AGENT_MODEL = "gpt-5.6-luna";

/** The server default model (AGENT_MODEL), used when a model group leaves a model empty. */
export function agentModel(): string {
  return process.env.AGENT_MODEL?.trim() || DEFAULT_AGENT_MODEL;
}

/** The three kinds of AI work; each model group names a model for each. */
export type ModelRole = "customer" | "assistant" | "utility";
export const MODEL_ROLES: readonly ModelRole[] = ["customer", "assistant", "utility"];
const PREFIX = "agjenti:";

/** A placeholder model id naming the kind of work. The OpenAI client replaces
 * it with the model of the business's group before the request is sent. */
export function modelFor(role: ModelRole): string {
  return `${PREFIX}${role}`;
}

export function roleOf(model: unknown): ModelRole | null {
  if (typeof model !== "string" || !model.startsWith(PREFIX)) return null;
  const role = model.slice(PREFIX.length);
  return (MODEL_ROLES as readonly string[]).includes(role) ? (role as ModelRole) : null;
}
