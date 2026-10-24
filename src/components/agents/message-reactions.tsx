"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { reactionCapabilities, type MessageReaction } from "@/lib/conversations/reactions";
import { useDashboardTranslator } from "@/components/dashboard/language";
import styles from "./message-reactions.module.css";

type Approval = { messageId: string; requestId: string; revision: number; emoji: string; retryAttempt?: number };
export function useMessageReactions(endpoint: string, storageKey: string) {
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [unresolved, setUnresolved] = useState<Approval | null>(null);
  const [posting, setPosting] = useState(false);
  const busy = useRef(false), serial = useRef(0), alive = useRef(true);
  const pending = useRef<Approval | null>(null);
  const save = useCallback((value: Approval | null) => {
    pending.current = value; setUnresolved(value);
    try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); } catch { /* Server operation stays authoritative. */ }
  }, [storageKey]);
  const refresh = useCallback(async () => {
    const n = ++serial.current;
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!alive.current || n !== serial.current) return;
      if (!Array.isArray(data.reactions)) throw new Error();
      setReactions(data.reactions); setReady(true); setError(null);
      const draft = pending.current;
      if (draft && data.reactions.some((r: MessageReaction) => r.requestId === draft.requestId || r.messageId === draft.messageId && r.actor === "business" && r.revision > draft.revision)) save(null);
    } catch {
      if (alive.current && n === serial.current) { setReady(false); setError("Reactions nuk u ngarkuan."); }
    }
  }, [endpoint, save]);
  useEffect(() => {
    alive.current = true;
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (stored && typeof stored.messageId === "string" && typeof stored.requestId === "string" && Number.isInteger(stored.revision) && typeof stored.emoji === "string") save(stored);
    } catch { /* Ignore malformed local hints, never trust them for authorization. */ }
    void refresh();
    const timer = setInterval(() => { if (!busy.current) void refresh(); }, 3000);
    const reconnect = () => void refresh(); window.addEventListener("online", reconnect);
    return () => { alive.current = false; clearInterval(timer); window.removeEventListener("online", reconnect); };
  }, [refresh, save, storageKey]);
  const submit = async (approval: Approval) => {
    if (busy.current) return;
    busy.current = true; serial.current++; setPosting(true); setActionError(null); save(approval);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(approval), signal: AbortSignal.timeout(45000) });
      if (!response.ok) {
        if ([400, 403, 409].includes(response.status)) save(null);
        throw new Error("Reaction nuk u konfirmua. Rifresko gjendjen para se të provosh përsëri.");
      }
    } catch {
      if (alive.current) setActionError("Reaction nuk u konfirmua. Rifresko gjendjen para se të provosh përsëri.");
    } finally {
      busy.current = false;
      if (alive.current) { setPosting(false); await refresh(); }
    }
  };
  return { reactions, ready, error: actionError ?? error, unresolved, posting, refresh,
    retryUnresolved: () => pending.current && submit(pending.current),
    send: (messageId: string, emoji: string, current?: MessageReaction) => submit({ messageId, emoji, revision: current?.revision ?? 0, requestId: crypto.randomUUID() }),
    retry: (reaction: MessageReaction) => reaction.canRetry && reaction.requestId && submit({ messageId: reaction.messageId, emoji: reaction.requestedEmoji ?? "", revision: reaction.revision, requestId: reaction.requestId, retryAttempt: reaction.attempt ?? undefined }),
  };
}
type Controller = ReturnType<typeof useMessageReactions>;
export function MessageReactions({ messageId, channel, eligible, parts, controller }: {
  messageId: string; channel: string; eligible: boolean; parts?: { id: string; part_index: number }[]; controller: Controller;
}) {
  const t = useDashboardTranslator();
  const details = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!details.current?.contains(event.target as Node)) details.current?.removeAttribute("open"); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  const rows = controller.reactions.filter(r => r.messageId === messageId);
  const own = rows.find(r => r.actor === "business");
  const caps = reactionCapabilities(channel);
  const localPending = controller.posting && controller.unresolved?.messageId === messageId;
  const locked = !controller.ready || controller.posting || Boolean(controller.unresolved) || own?.status === "sending" || own?.status === "uncertain";
  const close = () => { details.current?.removeAttribute("open"); details.current?.querySelector("summary")?.focus(); };
  return <div className={styles.reactions} aria-label={t("Reactions e mesazhit")}
    onKeyDown={e => { if (e.key === "Escape" && details.current?.open) { e.preventDefault(); close(); } }}>
    {localPending && own?.status !== "sending" && <span role="status">{t("Reaction po dërgohet…")}</span>}
    {rows.filter(r => r.emoji || r.ambiguous).map(r => {
      const content = <>{r.ambiguous ? t("Reaction i pasigurt") : r.emoji} · {t(r.actor === "business" ? "Biznesi" : "Klienti")}
        {r.partId && <span> · {t("Pjesa")} {(parts?.find(p => p.id === r.partId)?.part_index ?? 0) + 1}</span>}</>;
      return r.actor === "business" && eligible && caps.emoji.length
        ? <button key={r.id} type="button" className={styles.chip} title={t("Pranuar nga kanali, jo konfirmim leximi")}
            onClick={() => { details.current?.setAttribute("open", ""); details.current?.querySelector("button")?.focus(); }}>{content}</button>
        : <span key={r.id} className={styles.chip} title={t("Reaction i klientit")}>{content}</span>;
    })}
    {own?.status && own.status !== "sent" && (!localPending || own.status === "sending") && <span role="status" className={styles.notice}>{t(own.status === "sending" ? "Reaction po dërgohet…" : own.status === "uncertain" ? "Rezultati i reaction nuk dihet; nuk ridërgohet." : "Reaction dështoi.")}</span>}
    {!localPending && own?.status === "sent" && own.emoji === "" && <span role="status">{t("Reaction u hoq.")}</span>}
    {!localPending && own?.canRetry && <button type="button" disabled={locked} onClick={() => void controller.retry(own)}>{t("Riprovo të njëjtin reaction")}</button>}
    {eligible && caps.emoji.length > 0 && <details ref={details} className={styles.picker} onToggle={e => setOpen(e.currentTarget.open)}>
      <summary aria-label={t("Reago ndaj mesazhit")}>{own?.emoji || "☺"} <span>{t("Reago")}</span></summary>
      <div className={styles.choices} role="group" aria-label={t("Zgjidh reaction e biznesit")}>
        {caps.emoji.map(emoji => <button key={emoji} type="button" disabled={locked} aria-label={`${t("Reago")} ${emoji}`} aria-pressed={own?.emoji === emoji}
          onClick={() => { close(); void controller.send(messageId, emoji, own); }}>{emoji}</button>)}
        {own?.emoji && <button type="button" disabled={locked || !caps.remove} onClick={() => { close(); void controller.send(messageId, "", own); }}>{t("Hiq reaction")}</button>}
        {own?.emoji && !caps.remove && <small>{t("Heqja në këtë kanal nuk është aktivizuar.")}</small>}
        <small>{t("Një reaction i përbashkët për biznesin, jo për çdo operator.")}</small>
      </div>
    </details>}
  </div>;
}
