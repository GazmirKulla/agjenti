"use client";
import { LocalizedStatusBadge } from "@/components/dashboard/language";
import { useDashboardTranslator } from "@/components/dashboard/language";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { NormalizedAttachment } from "@/lib/instagram/types";
import { Icon } from "@/components/dashboard/icon";
import Link from "next/link";
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
};
export function ThreadClient(props: {
  businessId: string;
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
            </div>
          ))
        ) : (
          <p className="muted-copy text-center">{t("Biseda ende nuk ka mesazhe.")}</p>
        )}
      </div>
      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void request("messages", { body: text.trim() });
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
          disabled={pending}
        />
        <div className="composer-footer">
          <span>{t("Mesazhi dërgohet në")} {props.channel === "whatsapp" ? "WhatsApp" : "Instagram"}</span>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={pending || !text.trim()}
          >
            {pending ? t("Duke dërguar…") : t("Dërgo")}
            <Icon name="arrow" size={16} />
          </button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger mt-3">
            {t(error)}
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
