export type HistoryMessage = { role: "user" | "assistant"; content: string };
export type AssistantThread = { id: string; title: string; updatedAt: string; messages: HistoryMessage[] };

export function historyStorageKey(userId: string, slug: string) {
  return `agjenti:assistant-history:v1:${encodeURIComponent(userId)}:${encodeURIComponent(slug)}`;
}

// History is display/context only. Never persist confirmation tickets or attachment URLs.
export function readHistory(raw: string | null): AssistantThread[] {
  try {
    const rows: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, 30).flatMap(row => {
      if (!row || typeof row.id !== "string" || typeof row.title !== "string" ||
          typeof row.updatedAt !== "string" || !Number.isFinite(Date.parse(row.updatedAt)) || !Array.isArray(row.messages)) return [];
      const messages: HistoryMessage[] = row.messages.slice(-80).flatMap((m: unknown) => {
        if (!m || typeof m !== "object" || !("role" in m) || !("content" in m) ||
            (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return [];
        return [{ role: m.role, content: m.content.slice(0, 12000) }];
      });
      return messages.length ? [{ id: row.id.slice(0, 100), title: row.title.slice(0, 100), updatedAt: row.updatedAt, messages }] : [];
    });
  } catch { return []; }
}

export function saveThread(threads: AssistantThread[], id: string, messages: HistoryMessage[], now: string): AssistantThread[] {
  if (!messages.length) return threads;
  const title = messages.find(m => m.role === "user")?.content.trim().slice(0, 80) || "Bisedë me materiale";
  return [{ id, title, updatedAt: now, messages: messages.slice(-80).map(({ role, content }) => ({ role, content: content.slice(0, 12000) })) }, ...threads.filter(t => t.id !== id)].slice(0, 30);
}
