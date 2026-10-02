"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { NormalizedAttachment } from "@/lib/instagram/types";
import { StatusBadge } from "@/components/dashboard/ui";
import { Icon } from "@/components/dashboard/icon";
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
type Log = {
  id: string;
  target: string;
  status: string;
  error: string | null;
  created_at: string;
};
export function ThreadClient(props: {
  businessId: string;
  conversationId: string;
  status: string;
  customerName: string;
  messages: Message[];
  logs: Log[];
}) {
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
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Lidhja dështoi. Provo përsëri.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="panel chat-panel">
      <div className="chat-header">
        <span className="profile-avatar">
          {props.customerName.slice(0, 2).toUpperCase()}
        </span>
        <div>
          <h2>{props.customerName}</h2>
          <StatusBadge status={props.status} />
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={pending}
          onClick={() => router.refresh()}
          aria-label="Rifresko bisedën"
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
            ? "Pauzo Agjentin AI"
            : "Rifillo Agjentin AI"}
        </button>
        <button
          type="button"
          disabled={pending || props.status === "completed"}
          onClick={() => request("complete")}
        >
          Shëno si të mbyllur
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => request("orders")}
        >
          Konfirmo porosinë
        </button>
      </div>
      <div className="chat-messages" ref={messageList}>
        {props.messages.length === 200 && (
          <p className="muted-copy text-center">200 mesazhet më të fundit</p>
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
                          alt={attachment.caption || "Foto nga biseda"}
                          className="rounded-lg object-contain"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span>
                          Hap {attachment.filename || "bashkëngjitjen"} ↗
                        </span>
                      )}
                    </a>
                  );
                },
              )}
              {!m.body && !m.media?.length && <p>Mesazh pa tekst</p>}
              <small>
                {m.source === "agent"
                  ? "Agjenti AI"
                  : m.source === "staff"
                    ? "Ekipi"
                    : "Klienti"}{" "}
                ·{" "}
                {new Date(m.created_at).toLocaleTimeString("en-GB", {
                  hour12: false,
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "Europe/Tirane",
                })}
                {m.delivery_status ? ` · ${m.delivery_status}` : ""}
              </small>
              {m.delivery_error && (
                <p className="text-danger text-xs mt-1">{m.delivery_error}</p>
              )}
            </div>
          ))
        ) : (
          <p className="muted-copy text-center">Biseda ende nuk ka mesazhe.</p>
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
          Përgjigje manuale
        </div>
        <label className="sr-only" htmlFor="reply">
          Shkruaj një mesazh
        </label>
        <textarea
          id="reply"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Shkruaj një mesazh…"
          rows={3}
          disabled={pending}
        />
        <div className="composer-footer">
          <span>Mesazhi dërgohet në Instagram</span>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={pending || !text.trim()}
          >
            {pending ? "Duke dërguar…" : "Dërgo"}
            <Icon name="arrow" size={16} />
          </button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger mt-3">
            {error}
          </p>
        )}
      </form>
      <details className="chat-logs">
        <summary>Aktiviteti i integrimit të biznesit</summary>
        {props.logs.length ? (
          props.logs.map((l) => (
            <p key={l.id}>
              {l.target} · {l.status}
              {l.error ? ` · ${l.error}` : ""}
            </p>
          ))
        ) : (
          <p>Ende nuk ka aktivitet.</p>
        )}
      </details>
    </section>
  );
}
