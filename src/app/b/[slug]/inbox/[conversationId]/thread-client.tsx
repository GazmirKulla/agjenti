"use client";
import { LocalizedStatusBadge } from "@/components/dashboard/language";
import { useDashboardTranslator } from "@/components/dashboard/language";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { NormalizedAttachment } from "@/lib/instagram/types";
import { Icon } from "@/components/dashboard/icon";
import Link from "next/link";
import { useReplyOutbox } from "@/components/agents/reply-outbox";
import { IntegrationActivity, type IntegrationActivityLog } from "@/components/dashboard/integration-activity";
type Message = {
  id: string;
  direction: string;
  source: string;
  body: string | null;
  media: NormalizedAttachment[] | null;
  created_at: string;
  delivery_status: string | null;
  delivery_error: string | null;
  transport_request_id?: string | null;
  message_transport_parts?: { id: string; part_index: number; part_count: number; body: string; status: string }[];
};
export function ThreadClient(props: {
  businessId: string;
  userId: string;
  conversationId: string;
  slug: string;
  status: string;
  channel?: string;
  customerName: string;
  messages: Message[];
  logs: IntegrationActivityLog[];
}) {
  const t = useDashboardTranslator();
  const router = useRouter();
  const messageList = useRef<HTMLDivElement>(null);
  const lastMessageId = props.messages.at(-1)?.id;
  useEffect(() => {
    const list = messageList.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [lastMessageId]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const outbox = useReplyOutbox(`/api/businesses/${props.businessId}/conversations/${props.conversationId}/messages`, `agjenti:reply:${props.userId}:${props.businessId}:${props.conversationId}`, () => router.refresh());
  async function request(path: string, body?: object) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/businesses/${props.businessId}/conversations/${props.conversationId}/${path}`,
        {
          method: "POST",
          ...(body
            ? {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              }
            : {}),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Veprimi dështoi.");
      if (path === "messages") setText("");
      if (path === "delete") {
        router.push(`/b/${props.slug}/inbox`);
        router.refresh();
        return;
      }
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Lidhja dështoi. Provo përsëri.",
      );
    } finally {
      setPending(false);
    }
  }
  function confirmDelete() {
    if (
      !window.confirm(
        "Fshi këtë bisedë dhe të gjitha mesazhet e saj? Ky veprim nuk kthehet mbrapsht.",
      )
    ) {
      return;
    }
    void request("delete");
  }
  function confirmClearMessages() {
    if (!window.confirm(
      "Pastro të gjitha mesazhet e dërguara dhe të marra në këtë bisedë nga Agjenti.app? Biseda, klienti dhe porositë ruhen. Mesazhet në Instagram/WhatsApp nuk fshihen. Ky veprim nuk kthehet mbrapsht.",
    )) return;
    void request("clear-messages");
  }
  return (
    <section className="panel chat-panel">
      <div className="chat-header">
        <Link
          href={`/b/${props.slug}/inbox`}
          className="chat-mobile-back"
          aria-label={t("Kthehu te bisedat")}
        >
          ‹
        </Link>
        <Link
          href={`/b/${props.slug}/inbox/${props.conversationId}/customer`}
          className="chat-contact-link"
          aria-label={t("Hap detajet e klientit")}
        >
          <span className="profile-avatar">
            {props.customerName.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <h2>{props.customerName}</h2>
            <LocalizedStatusBadge status={props.status} />
          </div>
        </Link>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={pending}
          onClick={() => router.refresh()}
          aria-label={t("Rifresko bisedën")}
        >
          ↻
        </button>
      </div>
      <div className="chat-actions">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            request(props.status === "active" ? "pause" : "resume")
          }
        >
          {props.status === "active"
            ? t("Pauzo Agjentin AI")
            : t("Rifillo Agjentin AI")}
        </button>
        <button
          type="button"
          disabled={pending || props.status === "completed"}
          onClick={() => request("complete")}
        >
          {t("Shëno si të mbyllur")}</button>
        <button
          type="button"
          disabled={pending}
          onClick={() => request("orders")}
        >
          {t("Konfirmo porosinë")}</button>
        <button
          type="button"
          disabled={pending || !props.messages.length}
          onClick={confirmClearMessages}
        >
          {t("Pastro mesazhet")}</button>
        <button
          type="button"
          className="chat-action-danger"
          disabled={pending}
          onClick={confirmDelete}
        >
          {t("Fshi bisedën")}</button>
      </div>
      <div className="chat-messages" ref={messageList}>
        {props.messages.length === 200 && (
          <p className="muted-copy text-center">{t("200 mesazhet më të fundit")}</p>
        )}
        {props.messages.length ? (
          props.messages.map((m) => (
            <div
              key={m.id}
              className={`chat-message ${m.direction === "outbound" ? "outbound" : "inbound"}`}
            >
              {m.body && <p>{m.body}</p>}
              {(m.message_transport_parts?.length ?? 0) > 1 && <details><summary>Pjesët e dërgimit</summary>{m.message_transport_parts?.slice().sort((a,b)=>a.part_index-b.part_index).map(p=><p key={p.id}>Pjesa {p.part_index+1}/{p.part_count}: {p.status}</p>)}</details>}
              {(Array.isArray(m.media) ? m.media : []).map(
                (attachment, index) => {
                  const url = attachment?.sourceUrl;
                  if (typeof url !== "string" || !url.startsWith("https://"))
                    return null;
                  return (
                    <a
                      key={index}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="chat-attachment"
                    >
                      {attachment.kind === "image" ||
                      attachment.kind === "sticker" ? (
                        <Image
                          src={url}
                          width={360}
                          height={260}
                          unoptimized
                          alt={attachment.caption || t("Foto nga biseda")}
                          className="rounded-lg object-contain"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span>
                          {t("Hap")}{attachment.filename || t("bashkëngjitjen")} ↗
                        </span>
                      )}
                    </a>
                  );
                },
              )}
              {!m.body && !m.media?.length && <p>{t("Mesazh pa tekst")}</p>}
              <small>
                {m.source === "agent"
                  ? t("Agjenti AI")
                  : m.source === "staff"
                    ? t("Ekipi")
                    : t("Klienti")}{" "}
                ·{" "}
                {new Date(m.created_at).toLocaleTimeString("en-GB", {
                  hour12: false,
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "Europe/Tirane",
                })}
                {m.delivery_status ? ` · ${t(m.delivery_status)}` : ""}
              </small>
              {m.delivery_error && (
                <p className="text-danger text-xs mt-1">{t(m.delivery_error)}</p>
              )}
              {m.transport_request_id && outbox.operations.some(o => o.requestId === m.transport_request_id && o.canRetry) && <button type="button" onClick={()=>void outbox.retry(m.transport_request_id!)}>Provo përsëri të njëjtin dërgim</button>}
            </div>
          ))
        ) : (
          <p className="muted-copy text-center">{t("Biseda ende nuk ka mesazhe.")}</p>
        )}
        {outbox.operations.filter(o => !props.messages.some(m => m.transport_request_id === o.requestId)).map(o => <div key={o.requestId} className="chat-message outbound"><p>{o.body}</p><small>{o.status === "prepared" || o.status === "queued" ? "Në radhë" : o.status === "sending" ? "Duke dërguar" : o.status === "sent" ? "Pranuar nga kanali" : o.status === "uncertain" ? "Dërgim i pakonfirmuar — mos e ridërgo" : "Dështoi"}</small>{o.error && <p role="alert">{o.error}</p>}{o.status === "failed" && !o.accepted && <button type="button" onClick={()=>outbox.retry(o.requestId)}>Provo përsëri</button>}</div>)}
      </div>
      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() && outbox.enqueue(text.trim())) setText("");
        }}
      >
        <div className="composer-label">
          <Icon name="inbox" size={16} />
          {t("Përgjigje manuale")}</div>
        <label className="sr-only" htmlFor="reply">
          {t("Shkruaj një mesazh")}</label>
        <textarea
          id="reply"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("Shkruaj një mesazh…")}
          rows={3}
          maxLength={props.channel === "whatsapp" ? 4096 : 20000}
        />
        <div className="composer-footer">
          <span>{t("Mesazhi dërgohet në")} {props.channel === "whatsapp" ? "WhatsApp" : "Instagram"}</span>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={!text.trim()}
          >
            {t("Dërgo")}
            <Icon name="arrow" size={16} />
          </button>
        </div>
        {(error || outbox.error) && (
          <p role="alert" className="text-sm text-danger mt-3">
            {t(error || outbox.error)}
          </p>
        )}
      </form>
      <details className="chat-logs">
        <summary>{t("Aktiviteti i integrimit të biznesit")}</summary>
        <IntegrationActivity logs={props.logs} />
      </details>
    </section>
  );
}
