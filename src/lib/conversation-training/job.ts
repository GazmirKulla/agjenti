import { createServiceSupabase } from "@/lib/supabase/service";
import { decryptSecret } from "@/lib/crypto/tokens";
import { instagramGraph, instagramHistory } from "@/lib/conversation-learning/instagram-history";
import { ArchiveError, isZip, readArchive, ARCHIVE_LIMITS } from "./archive";
import { conversationFolder, parseConversationFile } from "./instagram-export";
import { agentMessageHashes, exportThreadMessages, inboxThreadMessages, withoutDuplicates, type StoredLine, type TrainingMessage } from "./normalize";

export const TRAINING_BUCKET = "conversation-training";
/** Inbox conversations active within this many days are read. */
export const INBOX_LOOKBACK_DAYS = 365;
const STEP_MS = 45_000;
const BATCH = 500;

export type UploadedFile = { path: string; name: string; size: number };
export type SessionInput = { files?: UploadedFile[]; ownerName?: string };
export type Stats = {
  conversations: number; messages: number; duplicates: number;
  customerMessages: number; ownerMessages: number; agentMessages: number;
  skippedFiles: number; groupConversations: number;
  firstAt: string | null; lastAt: string | null;
  owner?: string | null; warnings?: string[];
};
type Checkpoint = {
  /** Export: the uploaded file being read, the next conversation file in it, and the owner found. */
  file?: number; next?: number; owner?: string | null; counted?: boolean;
  /** Participant counts of the whole export (one-way hashes), and the names of the most frequent. */
  participants?: Record<string, number>; names?: Record<string, string>;
  /** Inbox: the next page of conversations, then the Instagram history. */
  offset?: number; history?: boolean;
  threads?: string[]; conversations?: number;
};
export type TrainingSession = {
  id: string; business_id: string; user_id: string | null; source: "inbox" | "instagram_export";
  status: string; stage: string; input: SessionInput; checkpoint: Checkpoint; stats: Partial<Stats>;
  lease_token: string; attempts: number;
};

export const emptyStats = (): Stats => ({ conversations: 0, messages: 0, duplicates: 0, customerMessages: 0, ownerMessages: 0, agentMessages: 0, skippedFiles: 0, groupConversations: 0, firstAt: null, lastAt: null });

export class TrainingStepError extends Error {}

async function save(session: TrainingSession, checkpoint: Checkpoint, stage: string, stats: Stats, progress: { done: number; total: number; label: string }, done = false, error: string | null = null) {
  const { data, error: failure } = await createServiceSupabase().rpc("checkpoint_conversation_training", {
    p_session: session.id, p_lease: session.lease_token, p_checkpoint: checkpoint, p_stage: stage,
    p_progress: progress, p_stats: stats, p_done: done, p_error: error,
  });
  if (failure) throw new Error("checkpoint_failed");
  if (!data) throw new Error("lease_expired");
}

/** Saves new messages and updates the counts; returns how many were new. */
async function ingest(session: TrainingSession, messages: TrainingMessage[], stats: Stats, threads: Set<string>) {
  const unique = withoutDuplicates(messages);
  stats.duplicates += messages.length - unique.length;
  let added = 0;
  for (let i = 0; i < unique.length; i += BATCH) {
    const rows = unique.slice(i, i + BATCH);
    const { data, error } = await createServiceSupabase().rpc("ingest_conversation_training_messages", { p_session: session.id, p_lease: session.lease_token, p_rows: rows });
    if (error) throw new Error(error.message.includes("lease_expired") ? "lease_expired" : "ingest_failed");
    added += Number(data ?? 0);
  }
  stats.duplicates += unique.length - added;
  // Counts describe what this session read, new or already known.
  for (const m of unique) {
    if (!threads.has(m.thread_key)) { threads.add(m.thread_key); stats.conversations++; }
    if (m.speaker === "customer") stats.customerMessages++;
    else if (m.speaker === "agent") stats.agentMessages++;
    else stats.ownerMessages++;
    if (!stats.firstAt || m.sent_at < stats.firstAt) stats.firstAt = m.sent_at;
    if (!stats.lastAt || m.sent_at > stats.lastAt) stats.lastAt = m.sent_at;
  }
  stats.messages += added;
  return added;
}

/** The agent's own replies, to tell them apart from the owner's inside an export. */
async function agentHashes(businessId: string) {
  const { data } = await createServiceSupabase().from("messages").select("body,created_at")
    .eq("business_id", businessId).eq("source", "agent").not("body", "is", null)
    .order("created_at", { ascending: false }).limit(20_000);
  return agentMessageHashes(businessId, (data ?? []) as { body: string; created_at: string }[]);
}

const sha = async (value: string) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("hex").slice(0, 24);

async function download(path: string) {
  const { data, error } = await createServiceSupabase().storage.from(TRAINING_BUCKET).download(path);
  if (error || !data) throw new TrainingStepError("Skedari i ngarkuar nuk u gjet. Ngarkoje përsëri.");
  return data;
}

/** Conversation files of one uploaded file, from conversation index `from`. */
async function readUploaded(file: UploadedFile, from: number) {
  const blob = await download(file.path);
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (isZip(head)) {
    try { return await readArchive(blob.stream(), from); }
    catch (error) {
      if (error instanceof ArchiveError) throw new TrainingStepError(error.code === "not_zip" || error.code === "corrupt"
        ? "Arkivi ZIP është i dëmtuar ose nuk lexohet." : error.code === "unsafe_path"
          ? "Arkivi ZIP përmban shtigje të pasigurta dhe nuk u lexua." : "Arkivi ZIP ka shumë skedarë. Shkarko nga Instagram vetëm «Mesazhet».");
      throw error;
    }
  }
  if (blob.size > ARCHIVE_LIMITS.fileBytes) return { files: [], total: 1, skipped: [{ path: file.name, reason: "too_large" as const }], nextIndex: null };
  const text = await blob.text();
  return { files: from > 0 ? [] : [{ index: 0, path: file.name, text }], total: 1, skipped: [], nextIndex: null };
}

const MAX_NAMES = 50;
/** First pass over the export: who is in each conversation, to find the account owner. */
async function countParticipants(session: TrainingSession, data: Checkpoint, stats: Stats) {
  const files = session.input.files ?? [];
  const started = Date.now();
  const counts = { ...(data.participants ?? {}) };
  const names = { ...(data.names ?? {}) };
  let file = data.file ?? 0, next = data.next ?? 0;
  while (file < files.length && Date.now() - started < STEP_MS) {
    const read = await readUploaded(files[file], next);
    const seen = new Map<string, Set<string>>();
    for (const item of read.files) {
      const thread = parseConversationFile(item.path, item.text);
      if (!thread) continue;
      const folder = conversationFolder(item.path);
      const set = seen.get(folder) ?? new Set();
      for (const name of thread.participants.length ? thread.participants : thread.messages.map((m) => m.sender)) set.add(name);
      seen.set(folder, set);
    }
    // A conversation split in several files counts once, even across steps (`threads`).
    const counted = new Set(data.threads ?? []);
    for (const [folder, people] of seen) {
      const key = await sha(`${file}:${folder}`);
      if (counted.has(key)) continue;
      counted.add(key);
      data.conversations = (data.conversations ?? 0) + 1;
      for (const name of people) {
        const id = await sha(name);
        counts[id] = (counts[id] ?? 0) + 1;
        if (counts[id] >= 2) names[id] = name;
      }
    }
    data.threads = [...counted].slice(-500);
    // The owner is in (nearly) every conversation: names in fewer than half cannot be it.
    for (const id of Object.keys(counts)) if (counts[id] < (data.conversations ?? 0) / 2) { delete counts[id]; delete names[id]; }
    if (read.nextIndex !== null) next = read.nextIndex; else { file++; next = 0; }
  }
  // Keep only the names that could be the owner: they appear in several conversations.
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, MAX_NAMES).map(([id]) => id);
  const kept = Object.fromEntries(top.filter((id) => names[id]).map((id) => [id, names[id]]));
  if (file < files.length) {
    await save(session, { ...data, file, next, participants: counts, names: kept }, "count", stats, { done: file, total: files.length, label: "Po njoh bisedat" });
    return;
  }
  const total = data.conversations ?? 0;
  const owner = session.input.ownerName?.trim() || ownerFrom(counts, kept, total);
  if (!owner) throw new TrainingStepError("Nuk u gjet cila është llogaria e biznesit në eksport. Ngarkoje përsëri dhe shkruaj emrin e llogarisë siç shfaqet në Instagram.");
  stats.owner = owner;
  await save(session, { file: 0, next: 0, owner, counted: true }, "ingest", stats, { done: 0, total: files.length, label: "Po lexoj mesazhet" });
}

/** The participant in most conversations, when clearly ahead of everyone else. */
export function ownerFrom(counts: Record<string, number>, names: Record<string, string>, conversations: number): string | null {
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  const [id, count] = ranked[0];
  if (!names[id]) return null;
  if (conversations < 2) return null;
  if (count < Math.max(2, Math.ceil(conversations * 0.6)) || ranked[1]?.[1] === count) return null;
  return names[id];
}

async function ingestExport(session: TrainingSession, data: Checkpoint, stats: Stats) {
  const files = session.input.files ?? [];
  const owner = data.owner!;
  const started = Date.now();
  const known = await agentHashes(session.business_id);
  let file = data.file ?? 0, next = data.next ?? 0;
  const threads = new Set<string>(data.threads ?? []);
  while (file < files.length && Date.now() - started < STEP_MS) {
    const read = await readUploaded(files[file], next);
    stats.skippedFiles += read.skipped.length;
    const messages: TrainingMessage[] = [];
    for (const item of read.files) {
      const thread = parseConversationFile(item.path, item.text);
      if (!thread) { stats.skippedFiles++; continue; }
      const outcome = exportThreadMessages(session.business_id, thread, owner, known);
      if (outcome.skipped === "group") stats.groupConversations++;
      messages.push(...outcome.messages);
    }
    await ingest(session, messages, stats, threads);
    if (read.nextIndex !== null) next = read.nextIndex; else { file++; next = 0; }
  }
  const checkpoint = { file, next, owner, counted: true, threads: [...threads].slice(-500) };
  if (file < files.length) return save(session, checkpoint, "ingest", stats, { done: file, total: files.length, label: "Po lexoj mesazhet" });
  await removeUploads(session);
  return finish(session, stats);
}

/** The uploaded files are deleted once read: only the masked messages remain. */
export async function removeUploads(session: Pick<TrainingSession, "input">) {
  const paths = (session.input.files ?? []).map((f) => f.path);
  if (paths.length) await createServiceSupabase().storage.from(TRAINING_BUCKET).remove(paths).catch(() => null);
}

async function finish(session: TrainingSession, stats: Stats) {
  if (!stats.customerMessages) stats.warnings = [...(stats.warnings ?? []), "Nuk u gjetën mesazhe nga klientët."];
  else if (!stats.ownerMessages) stats.warnings = [...(stats.warnings ?? []), "Nuk u gjetën përgjigje të shkruara nga biznesi."];
  // Phase 1 ends with the import; the analysis stages continue from here.
  return save(session, {}, "imported", stats, { done: 1, total: 1, label: "Importi përfundoi" }, true);
}

const PAGE = 40;
async function ingestInbox(session: TrainingSession, data: Checkpoint, stats: Stats) {
  const db = createServiceSupabase();
  const since = new Date(Date.now() - INBOX_LOOKBACK_DAYS * 86_400_000).toISOString();
  const started = Date.now();
  let offset = data.offset ?? 0;
  const threads = new Set<string>(data.threads ?? []);
  const { count } = await db.from("conversations").select("id", { count: "exact", head: true })
    .eq("business_id", session.business_id).in("channel", ["instagram", "whatsapp"]).gte("last_message_at", since);
  const total = count ?? 0;
  if (!data.history) {
    while (Date.now() - started < STEP_MS) {
      const { data: rows, error } = await db.from("conversations").select("id,channel,customers(instagram_user_id,username,display_name)")
        .eq("business_id", session.business_id).in("channel", ["instagram", "whatsapp"]).gte("last_message_at", since)
        .order("last_message_at", { ascending: false }).order("id").range(offset, offset + PAGE - 1);
      if (error) throw new Error("conversations_unavailable");
      if (!rows?.length) break;
      const messages: TrainingMessage[] = [];
      for (const row of rows) {
        const { data: lines, error: failure } = await db.from("messages").select("source,body,created_at")
          .eq("business_id", session.business_id).eq("conversation_id", row.id).not("body", "is", null)
          .in("source", ["customer", "staff", "agent"]).order("created_at", { ascending: true }).limit(1000);
        if (failure) throw new Error("messages_unavailable");
        const customer = (Array.isArray(row.customers) ? row.customers[0] : row.customers) as { instagram_user_id?: string | null; username?: string | null; display_name?: string | null } | null;
        const identity = row.channel === "instagram" && customer?.instagram_user_id ? `instagram:${customer.instagram_user_id}` : `stored:${row.id}`;
        messages.push(...inboxThreadMessages(session.business_id, identity, (lines ?? []) as StoredLine[], [customer?.display_name, customer?.username].filter((n): n is string => !!n)));
      }
      await ingest(session, messages, stats, threads);
      offset += rows.length;
      if (rows.length < PAGE) break;
    }
    const more = offset < total && Date.now() - started >= STEP_MS;
    return save(session, { offset, history: !more, threads: [...threads].slice(-500) }, more ? "ingest" : "history", stats,
      more ? { done: offset, total, label: "Po lexoj bisedat e Inbox-it" } : { done: total, total, label: "Po lexoj historinë e Instagram-it" });
  }
  // DMs from before Instagram was connected, as far as Meta gives them (20 per conversation).
  {
    const account = await instagramAccount(session.business_id);
    if (account) {
      const history = await instagramHistory({ graph: account.graph, accountId: account.accountId, since: new Date(since), maxConversations: 200, perConversation: 20 })
        .catch(() => { stats.warnings = [...(stats.warnings ?? []), "Historia e Instagram-it nuk u lexua këtë herë."]; return []; });
      const messages = history.flatMap((t) => inboxThreadMessages(session.business_id, t.key, t.lines.map((l) => ({
        source: l.speaker === "klienti" ? "customer" : l.speaker === "agjenti" ? "agent" : "staff", body: l.text, created_at: l.at,
      }) as StoredLine)));
      await ingest(session, messages, stats, threads);
    }
  }
  return finish(session, stats);
}

async function instagramAccount(businessId: string) {
  const { data } = await createServiceSupabase().from("instagram_connections")
    .select("ig_user_id,access_token_ciphertext,status,expires_at")
    .eq("business_id", businessId).eq("status", "connected")
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!data?.access_token_ciphertext || (data.expires_at && Date.parse(data.expires_at) < Date.now())) return null;
  try { return { accountId: String(data.ig_user_id), graph: instagramGraph(decryptSecret(data.access_token_ciphertext)) }; }
  catch { return null; }
}

export async function processTrainingStep(session: TrainingSession) {
  const stats = { ...emptyStats(), ...session.stats };
  const data = session.checkpoint ?? {};
  if (session.source === "inbox") return ingestInbox(session, data, stats);
  if (session.stage === "ingest" && !data.counted) return countParticipants(session, data, stats);
  if (session.stage === "count") return countParticipants(session, data, stats);
  if (session.stage === "ingest") return ingestExport(session, data, stats);
  throw new Error("invalid_stage");
}

/** Runs the due steps of one business (or of all), within the time of one call. */
export async function runTrainingQueue(businessId: string | null = null, budgetMs = 110_000) {
  const started = Date.now();
  let processed = 0;
  while (Date.now() - started < budgetMs - STEP_MS - 15_000) {
    const claim = await createServiceSupabase().rpc("claim_conversation_training", { p_business: businessId });
    if (claim.error) throw new Error("training_queue_unavailable");
    const session = (claim.data as TrainingSession[] | null)?.[0];
    if (!session) break;
    try { await processTrainingStep(session); }
    catch (error) {
      const message = error instanceof TrainingStepError ? error.message : "Importi u ndërpre. Do të provohet përsëri.";
      if (!(error instanceof TrainingStepError)) console.error("[conversation-training]", session.source, session.stage, error instanceof Error ? error.message.slice(0, 200) : "unknown");
      // A file that cannot be read will not improve on retry.
      if (error instanceof TrainingStepError) await failNow(session, message).catch(() => {});
      else await save(session, session.checkpoint, session.stage, { ...emptyStats(), ...session.stats }, { done: 0, total: 0, label: "Po provohet përsëri" }, false, message).catch(() => {});
    }
    processed++;
  }
  return processed;
}

async function failNow(session: TrainingSession, message: string) {
  await createServiceSupabase().from("conversation_training_sessions").update({ status: "failed", error: message, lease_token: null, leased_until: null, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", session.id).eq("lease_token", session.lease_token);
  await removeUploads(session);
}

/** Deletes imported conversations past their retention date, with their uploads. */
export async function purgeExpiredTraining() {
  const db = createServiceSupabase();
  const { data } = await db.from("conversation_training_sessions").select("id,input").lt("expires_at", new Date().toISOString()).limit(200);
  for (const row of data ?? []) {
    await removeUploads({ input: row.input as SessionInput });
    await db.from("conversation_training_sessions").delete().eq("id", row.id);
  }
  return data?.length ?? 0;
}
