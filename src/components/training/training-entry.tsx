"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/dashboard/icon";
import "./conversation-training.css";

type State = { enabled: boolean; keptMessages: number; sessions: { status: string; stats: { suggestions?: Record<string, number> } }[] };

/** On Knowledge: the way into training from conversations, with where it stands. */
export function TrainingEntry({ slug }: { slug: string }) {
  const [state, setState] = useState<State | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/conversation-training?slug=${encodeURIComponent(slug)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).then((data) => { if (live) setState(data); }).catch(() => null);
    return () => { live = false; };
  }, [slug]);
  if (state && !state.enabled) return null;
  const latest = state?.sessions[0];
  const running = latest && ["uploading", "queued", "running"].includes(latest.status);
  const found = latest?.status === "ready" ? Object.values(latest.stats.suggestions ?? {}).reduce((a, b) => a + b, 0) : 0;
  return (
    <Link href={`/b/${encodeURIComponent(slug)}/agents/training`} className="training-entry">
      <span className="knowledge-source-icon"><Icon name="chat" size={20} /></span>
      <span>
        <b>Mëso nga bisedat</b>
        <small>{running ? "Një import është në punë…" : found ? `${found} gjetje presin shqyrtimin tënd.` : "Mëson si shkruan ti, çfarë shet, çmimet dhe faktet, nga Inbox-i ose nga eksporti i Instagram-it. Çdo propozim e pranon ose e refuzon ti."}</small>
      </span>
      <span aria-hidden="true">→</span>
    </Link>
  );
}
