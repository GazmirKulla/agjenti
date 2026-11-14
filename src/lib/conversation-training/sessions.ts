import { randomUUID } from "node:crypto";
import { createServiceSupabase } from "@/lib/supabase/service";
import { PersistenceError } from "@/lib/business-assistant/persistence";
import { removeUploads, TRAINING_BUCKET, type SessionInput, type UploadedFile } from "./job";

export const MAX_FILES = 20;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
const EXTENSIONS = new Set(["zip", "json", "html", "htm"]);

export const sessionColumns = "id,source,status,stage,progress,stats,error,created_at,updated_at,finished_at,expires_at";

const startError = (message: string) => {
  if (message.includes("session_active")) return new PersistenceError("Një import është ende në punë. Prit sa të mbarojë.", 409);
  if (message.includes("daily_limit")) return new PersistenceError("U arrit kufiri i importeve për sot. Provo nesër.", 429);
  if (message.includes("unauthorized")) return new PersistenceError("Nuk ke qasje në këtë biznes.", 403);
  return new PersistenceError("Importi nuk u nis. Provo përsëri.");
};

export async function listSessions(businessId: string) {
  const db = createServiceSupabase();
  const [sessions, kept] = await Promise.all([
    db.from("conversation_training_sessions").select(sessionColumns).eq("business_id", businessId).order("created_at", { ascending: false }).limit(20),
    db.from("conversation_training_messages").select("id", { count: "exact", head: true }).eq("business_id", businessId),
  ]);
  if (sessions.error) throw new PersistenceError("Importet nuk u ngarkuan.", sessions.error.code === "42P01" || sessions.error.code === "PGRST205" ? 503 : 500);
  return { sessions: sessions.data ?? [], keptMessages: kept.count ?? 0 };
}

export async function startInbox(businessId: string, userId: string) {
  const { data, error } = await createServiceSupabase().rpc("start_conversation_training", { p_business: businessId, p_user: userId, p_source: "inbox", p_input: {}, p_status: "queued" });
  if (error) throw startError(error.message);
  return { id: data as string };
}

/** Validates the files the owner chose and returns one signed upload URL per file:
 * the browser sends them straight to private storage, never through this server. */
export async function prepareUpload(businessId: string, userId: string, input: { files?: unknown; ownerName?: unknown }) {
  const list = Array.isArray(input.files) ? input.files : [];
  if (!list.length || list.length > MAX_FILES) throw new PersistenceError(`Zgjidh nga 1 deri në ${MAX_FILES} skedarë.`, 400);
  const ownerName = typeof input.ownerName === "string" ? input.ownerName.trim() : "";
  if (ownerName.length > 120) throw new PersistenceError("Emri i llogarisë është shumë i gjatë.", 400);
  const files: UploadedFile[] = list.map((raw) => {
    const item = raw && typeof raw === "object" ? (raw as { name?: unknown; size?: unknown }) : {};
    const name = typeof item.name === "string" ? item.name.trim().slice(-200) : "";
    const size = typeof item.size === "number" ? item.size : Number.NaN;
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (!name || !EXTENSIONS.has(ext)) throw new PersistenceError("Ngarko ZIP-in e eksportit të Instagram-it, ose skedarë JSON/HTML të bisedave.", 400);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_BYTES) throw new PersistenceError("Çdo skedar duhet të jetë deri në 100 MB. Shkarko nga Instagram vetëm «Mesazhet».", 400);
    return { name, size, path: `${businessId}/${randomUUID()}.${ext === "htm" ? "html" : ext}` };
  });
  const sessionInput: SessionInput = { files, ...(ownerName ? { ownerName } : {}) };
  const db = createServiceSupabase();
  const { data: id, error } = await db.rpc("start_conversation_training", { p_business: businessId, p_user: userId, p_source: "instagram_export", p_input: sessionInput, p_status: "uploading" });
  if (error) throw startError(error.message);
  const uploads = [];
  for (const file of files) {
    const signed = await db.storage.from(TRAINING_BUCKET).createSignedUploadUrl(file.path);
    if (signed.error || !signed.data) {
      await db.from("conversation_training_sessions").update({ status: "cancelled", error: "Ngarkimi nuk u përgatit.", finished_at: new Date().toISOString() }).eq("id", id);
      throw new PersistenceError("Ngarkimi nuk u përgatit. Provo përsëri.", 503);
    }
    uploads.push({ name: file.name, url: signed.data.signedUrl });
  }
  return { id: id as string, uploads };
}

async function session(businessId: string, id: unknown) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new PersistenceError("Importi nuk u gjet.", 404);
  const { data } = await createServiceSupabase().from("conversation_training_sessions").select("id,status,input,source").eq("business_id", businessId).eq("id", id).maybeSingle();
  if (!data) throw new PersistenceError("Importi nuk u gjet.", 404);
  return data as { id: string; status: string; input: SessionInput; source: string };
}

/** After the browser uploaded the files: checks each one is there and within the limit, then queues the import. */
export async function confirmUpload(businessId: string, id: unknown) {
  const row = await session(businessId, id);
  if (row.status !== "uploading") throw new PersistenceError("Ky import është nisur tashmë.", 409);
  const db = createServiceSupabase();
  const files: UploadedFile[] = [];
  for (const file of row.input.files ?? []) {
    const [folder, name] = file.path.split("/");
    const { data } = await db.storage.from(TRAINING_BUCKET).list(folder, { search: name, limit: 2 });
    const object = data?.find((o) => o.name === name);
    const size = Number((object?.metadata as { size?: number } | undefined)?.size ?? Number.NaN);
    if (!object || !Number.isFinite(size)) throw new PersistenceError(`«${file.name}» nuk u ngarkua plotësisht. Provo përsëri.`, 409);
    if (size > MAX_FILE_BYTES) throw new PersistenceError(`«${file.name}» është më i madh se 100 MB.`, 400);
    files.push({ ...file, size });
  }
  const { error } = await db.from("conversation_training_sessions").update({ status: "queued", input: { ...row.input, files }, next_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("business_id", businessId).eq("id", row.id).eq("status", "uploading");
  if (error) throw new PersistenceError("Importi nuk u nis. Provo përsëri.");
  return { id: row.id };
}

/** Deletes one import with the messages it brought, or stops it while it runs. */
export async function deleteSession(businessId: string, id: unknown) {
  const row = await session(businessId, id);
  await removeUploads(row);
  const { error } = await createServiceSupabase().from("conversation_training_sessions").delete().eq("business_id", businessId).eq("id", row.id);
  if (error) throw new PersistenceError("Importi nuk u fshi. Provo përsëri.");
  return { deleted: row.id };
}

/** Deletes every imported conversation of the business. */
export async function deleteAllTraining(businessId: string) {
  const db = createServiceSupabase();
  const { data } = await db.from("conversation_training_sessions").select("id,input").eq("business_id", businessId);
  for (const row of data ?? []) await removeUploads({ input: row.input as SessionInput });
  const { error } = await db.from("conversation_training_sessions").delete().eq("business_id", businessId);
  if (error) throw new PersistenceError("Të dhënat nuk u fshinë. Provo përsëri.");
  return { deleted: data?.length ?? 0 };
}

export const suggestionColumns = "id,destination,operation,target_table,target_id,title,current_value,proposed,evidence,confidence,explicit,requires_confirmation,risk,status,edited,created_at";
/** What one analysis proposes, for the owner's review. Evidence quotes carry no names or contacts. */
export async function listSuggestions(businessId: string, sessionId: unknown) {
  const row = await session(businessId, sessionId);
  const { data, error } = await createServiceSupabase().from("conversation_training_suggestions").select(suggestionColumns)
    .eq("business_id", businessId).eq("session_id", row.id).order("destination").order("created_at").limit(1000);
  if (error) throw new PersistenceError("Sugjerimet nuk u ngarkuan.", error.code === "42P01" || error.code === "PGRST205" ? 503 : 500);
  return { suggestions: data ?? [] };
}
