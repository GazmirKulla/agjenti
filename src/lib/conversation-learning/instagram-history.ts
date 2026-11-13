import { graphVersion } from "@/lib/instagram/oauth";
import { INSTAGRAM_MESSAGE_LIMIT } from "./settings";
import type { Line, Transcript } from "./transcripts";

type Graph = (path: string, params: Record<string, string>) => Promise<Record<string, unknown>>;
type Participant = { id?: string; username?: string };
type Message = { id?: string; created_time?: string; from?: Participant; message?: string };

/** One authorized GET to the Instagram Graph API (Instagram Login). */
export function instagramGraph(token: string, fetcher: typeof fetch = fetch): Graph {
  return async (path, params) => {
    const url = new URL(`https://graph.instagram.com/${graphVersion()}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const error = body.error as { message?: string } | undefined;
      throw new Error(`Instagram: ${error?.message?.slice(0, 160) ?? response.status}`);
    }
    return body;
  };
}

const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** Instagram DMs, including those from before the account was connected: the
 * newest conversations active since `since`, each with its newest messages
 * (Meta gives details of only the last 20). The key is the customer's IGSID,
 * the same one stored on customers, so stored conversations are not read twice. */
export async function instagramHistory(params: {
  graph: Graph;
  accountId: string;
  since: Date;
  maxConversations: number;
  perConversation: number;
  /** Message ids the agent sent: those business lines are the agent's, not the owner's. */
  agentMessageIds?: Set<string>;
}): Promise<Transcript[]> {
  const per = Math.min(params.perConversation, INSTAGRAM_MESSAGE_LIMIT);
  const conversations: { id: string; customer: string; updated: string }[] = [];
  let after: string | undefined;
  for (let page = 0; page < 10 && conversations.length < params.maxConversations; page++) {
    const body = await params.graph("me/conversations", {
      platform: "instagram", fields: "id,updated_time,participants", limit: "25", ...(after ? { after } : {}),
    });
    let older = false;
    for (const row of list<{ id?: string; updated_time?: string; participants?: { data?: Participant[] } }>(body.data)) {
      if (!row.id || !row.updated_time) continue;
      if (Date.parse(row.updated_time) < params.since.getTime()) { older = true; break; }
      const customer = list<Participant>(row.participants?.data).find((p) => p.id && p.id !== params.accountId)?.id;
      if (customer) conversations.push({ id: row.id, customer, updated: new Date(row.updated_time).toISOString() });
      if (conversations.length >= params.maxConversations) break;
    }
    const paging = body.paging as { cursors?: { after?: string }; next?: string } | undefined;
    after = paging?.next ? paging.cursors?.after : undefined;
    if (older || !after) break;
  }

  const readMessages = async (conversation: (typeof conversations)[number]): Promise<Transcript | null> => {
    const body = await params.graph(conversation.id, { fields: `messages.limit(${per}){id,created_time,from,message}` });
    let messages = list<Message>((body.messages as { data?: unknown } | undefined)?.data).slice(0, per);
    // Some API versions return only ids here; the details are then read one by one.
    if (messages.length && messages.every((m) => m.message === undefined && !m.from)) {
      messages = await Promise.all(messages.map((m) => (m.id ? params.graph(m.id, { fields: "id,created_time,from,message" }).catch(() => ({})) : {}) as Promise<Message>));
    }
    const lines: Line[] = messages
      .filter((m) => typeof m.message === "string" && m.created_time)
      .map((m) => ({
        speaker: m.from?.id === conversation.customer ? "klienti" : m.id && params.agentMessageIds?.has(m.id) ? "agjenti" : "biznesi",
        text: m.message as string,
        at: new Date(m.created_time as string).toISOString(),
      }));
    return lines.length ? { key: `instagram:${conversation.customer}`, channel: "instagram", lines, lastAt: conversation.updated } : null;
  };

  const out: Transcript[] = [];
  // A few at a time, to stay well within Meta's rate limits.
  for (let i = 0; i < conversations.length; i += 5) {
    const batch = await Promise.all(conversations.slice(i, i + 5).map((c) => readMessages(c).catch(() => null)));
    out.push(...batch.filter((t): t is Transcript => !!t));
  }
  return out;
}
