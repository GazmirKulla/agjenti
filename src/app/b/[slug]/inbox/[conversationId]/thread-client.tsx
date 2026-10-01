"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Message = {
  id: string;
  direction: string;
  source: string;
  body: string | null;
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
  messages: Message[];
  logs: Log[];
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(
      `/api/businesses/${props.businessId}/conversations/${props.conversationId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      },
    );
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Dërgimi dështoi.");
      return;
    }
    setText("");
    router.refresh();
  }

  async function act(action: string) {
    await fetch(
      `/api/businesses/${props.businessId}/conversations/${props.conversationId}/${action}`,
      { method: "POST" },
    );
    router.refresh();
  }

  async function confirmOrder() {
    setError(null);
    const res = await fetch(
      `/api/businesses/${props.businessId}/conversations/${props.conversationId}/orders`,
      { method: "POST" },
    );
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Porosia dështoi.");
    else router.refresh();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
      <section className="rounded-lg border bg-white p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          <button className="rounded border px-3 py-1 text-sm" type="button" onClick={() => act("pause")}>
            Pauzo
          </button>
          <button className="rounded border px-3 py-1 text-sm" type="button" onClick={() => act("resume")}>
            Rifillo
          </button>
          <button className="rounded border px-3 py-1 text-sm" type="button" onClick={() => act("complete")}>
            Mbyll
          </button>
          <button className="rounded border px-3 py-1 text-sm" type="button" onClick={confirmOrder}>
            Konfirmo porosinë
          </button>
          <span className="text-sm text-zinc-500">{props.status}</span>
        </div>
        <div className="mb-4 max-h-[28rem] space-y-2 overflow-y-auto">
          {props.messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                m.direction === "inbound" ? "bg-zinc-100" : "ml-auto bg-zinc-900 text-white"
              }`}
            >
              <p>{m.body}</p>
              <p className="mt-1 text-[10px] opacity-70">
                {m.source}
                {m.delivery_error ? ` · ${m.delivery_error}` : ""}
              </p>
            </div>
          ))}
        </div>
        <form onSubmit={send} className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="flex-1 rounded border px-3 py-2"
            placeholder="Përgjigju..."
          />
          <button className="rounded bg-zinc-900 px-4 py-2 text-white" type="submit">
            Dërgo
          </button>
        </form>
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      </section>
      <aside className="rounded-lg border bg-white p-4 text-sm">
        <h2 className="mb-2 font-medium">Logje</h2>
        <ul className="space-y-2">
          {props.logs.map((l) => (
            <li key={l.id}>
              {l.target} · {l.status}
              {l.error ? ` · ${l.error}` : ""}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
