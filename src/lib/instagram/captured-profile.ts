import { cleanBusinessProfile } from "./business-profile";

type Connection = { id: string; discovery_generation: string; status?: string };
type Capture = { source: string; input?: Record<string, unknown>; checkpoint?: Record<string, unknown> };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

// Both onboarding and the Instagram module must follow the current OAuth
// connection generation. A saved profile can belong to a previous account.
export function capturedInstagramProfile(connection: Connection | null, jobs: Capture[], saved: unknown) {
  if (!connection?.id || !connection.discovery_generation || connection.status === "disconnected") return null;
  const captured = jobs.find(job => job.source === "instagram" &&
    job.input?.connectionId === connection.id &&
    job.input?.generation === connection.discovery_generation &&
    record(job.checkpoint?.profile))?.checkpoint?.profile;
  const profile = captured ?? (record(saved) && saved.connectionId === connection.id &&
    saved.generation === connection.discovery_generation ? saved : null);
  return record(profile) ? cleanBusinessProfile(profile) : null;
}
