"use client";
import { Fragment, useState } from "react";
import { Icon } from "@/components/dashboard/icon";

export function CopyMessage({ text }: { text: string }) {
  const [status, setStatus] = useState("");
  return <><button type="button" className="chat-icon" title="Kopjo" aria-label="Kopjo mesazhin" onClick={async () => {
    try { await navigator.clipboard.writeText(text); setStatus("U kopjua"); }
    catch { setStatus("Kopjimi dështoi; zgjidhe tekstin manualisht."); }
  }}><Icon name={status === "U kopjua" ? "check" : "copy"} size={16} /></button><span className="sr-only" role="status">{status}</span></>;
}
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2,-2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1,-1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (link) return <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}
/** Text-only Markdown rendering: no HTML injection or executable links. */
export function ChatMessage({ text }: { text: string }) {
  const blocks = text.split(/(```[^\n]*\n[\s\S]*?```)/g);
  return <div className="chat-markdown">{blocks.map((block, i) => {
    if (block.startsWith("```")) {
      const end = block.indexOf("\n"); const code = block.slice(end+1,-3);
      return <div className="chat-code" key={i}><header><span>{block.slice(3,end) || "Tekst"}</span><CopyMessage text={code} /></header><pre><code>{code}</code></pre></div>;
    }
    return <Fragment key={i}>{block.split(/\n\n+/).filter(Boolean).map((p,j) => {
      const lines = p.split("\n");
      if (lines.every(l => /^\s*[-*] /.test(l))) return <ul key={j}>{lines.map((l,k) => <li key={k}>{inline(l.replace(/^\s*[-*] /,""))}</li>)}</ul>;
      if (lines.every(l => /^\d+\. /.test(l))) return <ol key={j}>{lines.map((l,k) => <li key={k}>{inline(l.replace(/^\d+\. /,""))}</li>)}</ol>;
      if (/^#{1,6} /.test(p)) return <h4 key={j}>{inline(p.replace(/^#{1,6} /,""))}</h4>;
      return <p key={j}>{inline(p)}</p>;
    })}</Fragment>;
  })}</div>;
}
