"use client";
import { LocalizedStatusBadge } from "@/components/dashboard/language";
import { useDashboardTranslator } from "@/components/dashboard/language";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import type { NormalizedAttachment } from "@/lib/instagram/types";
import { Icon } from "@/components/dashboard/icon";
import Link from "next/link";
import { RowMenu } from "@/components/dashboard/row-menu";
import { messageDate } from "@/lib/conversations/message-date";
import { instagramReplyWindow } from "@/lib/instagram/window";
import { useReplyOutbox } from "@/components/agents/reply-outbox";
import { MessageReactions, useMessageReactions } from "@/components/agents/message-reactions";
import { IntegrationActivity, type IntegrationActivityLog } from "@/components/dashboard/integration-activity";
type Message = {
  id: string;
  direction: string;
  source: string;
  sent_via?: string | null;
  body: string | null;
  media: NormalizedAttachment[] | null;
  created_at: string;
  delivery_status: string | null;
  delivery_error: string | null;
  transport_request_id?: string | null;
  external_message_id?: string | null;
  message_transport_parts?: { id: string; part_index: number; part_count: number; body: string; status: string }[];
};
export function ThreadClient(props: {
  businessId: string;
  userId: string;
  conversationId: string;
  slug: string;
  status: string;
  channel?: string;
  lastInboundAt?: string | null;
  customerName: string;
  messages: Message[];
  /** Reads the messages before the first one shown; null when there are none. */
  older?: string | null;
  /** An order the agent prepared waits for staff confirmation. */
  pendingOrder?: boolean;
  /** The owner can record an order / book an appointment from this conversation. */
  canOrder?: boolean;
  canBook?: boolean;
  logs: IntegrationActivityLog[];
}) {
  const t = useDashboardTranslator();
  const replyWindow = props.channel === "instagram" ? instagramReplyWindow(props.lastInboundAt) : "standard";
  const router = useRouter();
  const messageList = useRef<HTMLDivElement>(null);
  // Older messages the owner loaded; the latest page refreshes from the server on its own.
  const [earlier, setEarlier] = useState<{ messages: Message[]; older: string | null } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState(false);
  const keepScroll = useRef<number | null>(null);
  const latestIds = new Set(props.messages.map((m) => m.id));
  // Cleared messages leave nothing older to show either.
  const messages = props.messages.length ? [...(earlier?.messages ?? []).filter((m) => !latestIds.has(m.id)), ...props.messages] : [];
  const older = !props.messages.length ? null : earlier ? earlier.older : props.older ?? null;
  async function loadOlder() {
    if (!older || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(false);
    try {
      const res = await fetch(`/api/businesses/${props.businessId}/conversations/${props.conversationId}/history?before=${encodeURIComponent(older)}`);
      const json = (await res.json()) as { messages?: Message[]; older?: string | null };
      if (!res.ok || !Array.isArray(json.messages)) throw new Error("load");
      keepScroll.current = messageList.current ? messageList.current.scrollHeight - messageList.current.scrollTop : null;
      setEarlier((current) => ({ messages: [...json.messages!, ...(current?.messages ?? [])], older: json.older ?? null }));
    } catch {
      setOlderError(true);
    } finally {
      setLoadingOlder(false);
    }
  }
  useLayoutEffect(() => {
    const list = messageList.current;
    if (list && keepScroll.current !== null) {
      list.scrollTop = list.scrollHeight - keepScroll.current;
      keepScroll.current = null;
    }
  }, [earlier]);
  const lastMessageId = props.messages.at(-1)?.id;
  useEffect(() => {
    const list = messageList.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [lastMessageId]);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport || !/AgjentiNative\/2\.0/.test(navigator.userAgent)) return;
    const sync = () => {
      document.documentElement.style.setProperty(
        "--keyboard-inset",
        `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`,
      );
    };
    sync();
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    return () => {
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
      document.documentElement.style.removeProperty("--keyboard-inset");
    };
  }, []);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const outbox = useReplyOutbox(`/api/businesses/${props.businessId}/conversations/${props.conversationId}/messages`, `agjenti:reply:${props.userId}:${props.businessId}:${props.conversationId}`, () => router.refresh());
  const reactions = useMessageReactions(`/api/businesses/${props.businessId}/conversations/${props.conversationId}/reactions`, `agjenti:reaction:${props.userId}:${props.businessId}:${props.conversationId}`);
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
      // Accepted is not always completed (an order awaiting reconciliation).
      if (json.ok === false && json.error) setError(json.error);
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
  function confirmOrder() {
    if (!window.confirm(t("Dërgo porosinë që përgatiti agjenti? Kontrollo produktet dhe të dhënat te paneli i klientit. Ky veprim nuk kthehet mbrapsht."))) return;
    void request("orders");
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
        <RowMenu
          label={t("Opsionet e bisedës")}
          title={props.customerName}
          triggerClassName="btn btn-ghost chat-options"
          items={[
            {
              group: t("Veprimet kryesore"),
              icon: props.status === "active" ? "Ⅱ" : "▶",
              label: props.status === "active" ? t("Pauzo Agjentin AI") : t("Rifillo Agjentin AI"),
              hint: props.status === "active" ? t("Përgjigju vetë; agjenti nuk shkruan.") : t("Agjenti u përgjigjet sërish automatikisht."),
              disabled: pending,
              onSelect: () => void request(props.status === "active" ? "pause" : "resume"),
            },
            ...(props.pendingOrder ? [{ group: t("Veprimet kryesore"), icon: "✓", label: t("Konfirmo porosinë"), hint: t("Kontrollo dhe dërgo porosinë që përgatiti agjenti."), badge: t("në pritje"), disabled: pending, onSelect: confirmOrder }] : []),
            ...(props.canOrder ? [{ group: t("Veprimet kryesore"), icon: "＋", label: t("Krijo porosi"), hint: t("Plotësohet vetë nga biseda."), href: `/b/${props.slug}/inbox/${props.conversationId}/customer#krijo-porosi` }] : []),
            ...(props.canBook ? [{ group: t("Veprimet kryesore"), icon: "◷", label: t("Cakto takim"), hint: t("Shërbimi, data dhe ora nga biseda."), href: `/b/${props.slug}/inbox/${props.conversationId}/customer#cakto-takim` }] : []),
            { group: t("Informacioni"), icon: "☺", label: t("Detajet e klientit"), hint: t("Kontakti, porositë dhe takimet."), href: `/b/${props.slug}/inbox/${props.conversationId}/customer` },
            { group: t("Menaxhimi i bisedës"), icon: "⌫", label: t("Pastro mesazhet"), hint: t("Fshin mesazhet; klienti dhe porositë ruhen."), danger: true, disabled: pending || !props.messages.length, onSelect: confirmClearMessages },
            { group: t("Menaxhimi i bisedës"), icon: "✕", label: t("Fshi bisedën"), hint: t("Heq bisedën përgjithmonë."), danger: true, disabled: pending, onSelect: confirmDelete },
          ]}
        />
        <Link
          href={`/b/${props.slug}/inbox`}
          className="btn btn-ghost chat-close"
          aria-label={t("Mbyll pamjen e bisedës")}
          title={t("Mbyll pamjen e bisedës")}
        >
          <span aria-hidden="true">×</span>
        </Link>
      </div>
      <div className="chat-messages" ref={messageList}>
        {reactions.error && <p role="alert">{t(reactions.error)} <button type="button" onClick={() => void reactions.refresh()}>{t("Rifresko")}</button></p>}
        {reactions.unresolved && !reactions.posting && <p role="status">{t("Reaction pret rakordim.")} <button type="button" onClick={() => void reactions.retryUnresolved()}>{t("Riprovo të njëjtën kërkesë")}</button></p>}
        {older && (
          <button type="button" className="btn btn-ghost chat-load-older" onClick={() => void loadOlder()} disabled={loadingOlder}>
            {loadingOlder ? t("Duke ngarkuar…") : olderError ? t("Provo përsëri") : t("Shiko mesazhet më të hershme")}
          </button>
        )}
        {messages.length ? (
          messages.map((m, index) => {
            const date = messageDate(m.created_at, t("sq-AL"));
            const previous = index > 0 ? messageDate(messages[index - 1].created_at, t("sq-AL")) : null;
            return <Fragment key={m.id}>
              {date.day !== previous?.day && <div className="chat-date-separator"><time dateTime={date.day}>{date.label}</time></div>}

            <div
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
              <div className="chat-message-footer">
              <small>
                {m.source === "agent"
                  ? t("Agjenti AI")
                  : m.sent_via === "instagram_app"
                    ? t("Dërguar nga Instagram")
                    : m.sent_via === "whatsapp_app"
                      ? t("Dërguar nga WhatsApp")
                      : m.source === "staff"
                        ? t("Ekipi")
                        : t("Klienti")}{" "}
                ·{" "}
                <time dateTime={m.created_at} title={date.full} aria-label={date.full}>{date.time}</time>
                {m.delivery_status ? ` · ${t(m.delivery_status)}` : ""}
              </small>
              <MessageReactions messageId={m.id} channel={props.channel ?? "instagram"} eligible={m.direction === "inbound" && m.source === "customer" && Boolean(m.external_message_id)} parts={m.message_transport_parts} controller={reactions} />
              </div>
              {m.delivery_error && (
                <p className="text-danger text-xs mt-1">{t(m.delivery_error)}</p>
              )}
              {m.transport_request_id && outbox.operations.some(o => o.requestId === m.transport_request_id && o.canRetry) && <button type="button" onClick={()=>void outbox.retry(m.transport_request_id!)}>Provo përsëri të njëjtin dërgim</button>}
            </div>
            </Fragment>;
          })
        ) : (
          <p className="muted-copy text-center">{t("Biseda ende nuk ka mesazhe.")}</p>
        )}
        {outbox.operations.filter(o => !props.messages.some(m => m.transport_request_id === o.requestId)).map(o => <div key={o.requestId} className="chat-message outbound"><p>{o.body}</p><small>{o.status === "prepared" || o.status === "queued" ? "Në radhë" : o.status === "sending" ? "Duke dërguar" : o.status === "sent" ? "Pranuar nga kanali" : o.status === "uncertain" ? "Dërgim i pakonfirmuar — mos e ridërgo" : "Dështoi"}</small>{o.error && <p role="alert">{o.error}</p>}{o.status === "failed" && !o.accepted && <button type="button" onClick={()=>outbox.retry(o.requestId)}>Provo përsëri</button>}</div>)}
      </div>
      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (replyWindow !== "closed" && text.trim() && outbox.enqueue(text.trim())) setText("");
        }}
      >
        <div className="composer-label">
          <Icon name="inbox" size={16} />
          {t("Përgjigje manuale")}</div>
        {replyWindow === "human_agent" && <p className="muted-copy" role="status">{t("Pas 24 orëve lejohet vetëm përgjigje njerëzore për kërkesën e klientit, deri në 7 ditë. Kërkohet leja Human Agent nga Meta.")}</p>}
        {replyWindow === "closed" && <p className="muted-copy" role="status">{t("Afati i përgjigjes ka përfunduar. Klienti duhet të shkruajë përsëri.")}</p>}
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
            disabled={!text.trim() || replyWindow === "closed"}
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
