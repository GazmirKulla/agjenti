"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { Icon } from "@/components/dashboard/icon";
import "./composer.css";
export type ComposerItem = { id: string; name: string; preview?: string; status?: string };
export function AssistantComposer({ id, value, onChange, onSubmit, onVoice, onOpen, placeholder = "Pyet ose kërko një ndryshim…", busy = false, items = [], onFiles, onRemove, onLink, maxLength = 12000, canSubmit, onStop, children }: {
  id: string; value: string; onChange: (value: string) => void; onSubmit: () => void; onVoice: () => void; onOpen?: () => void;
  placeholder?: string; busy?: boolean; multiline?: boolean; items?: ComposerItem[]; onFiles?: (files: File[]) => void;
  onRemove?: (id: string) => void; onLink?: (url: string) => void; maxLength?: number; canSubmit?: boolean; onStop?: () => void; children?: ReactNode;
}) {
  const menuButton = useRef<HTMLButtonElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [linkError, setLinkError] = useState("");
  useEffect(() => {
    const field = textarea.current;
    if (!field) return;
    const resize = () => {
      if (!field.clientWidth) return;
      field.style.height = "auto";
      field.style.height = `${Math.min(field.scrollHeight, 192)}px`;
    };
    resize();
    // Recalculate wrapping when the keyboard, panel or screen changes width.
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (field.clientWidth !== width) { width = field.clientWidth; resize(); }
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [value]);
  const pastedLinks = [...new Set(value.match(/https?:\/\/[^\s<>"']+/g) ?? [])].filter(url => !items.some(item => item.name === url));
  const visibleItems = [...items, ...pastedLinks.map(url => ({ id: `url:${url}`, name: url }))];
  const canSend = !busy && (canSubmit ?? (Boolean(value.trim()) || items.length > 0));
  function addLink() {
    try { const url = new URL(link ?? ""); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw Error();
      if (onLink) onLink(url.href); else onChange(`${value}${value ? "\n" : ""}${url.href}`);
      setLink(null); setLinkError(""); setMenu(false);
    } catch { setLinkError("Vendos një link të plotë http ose https."); }
  }
  return <div className="unified-composer" onDragOver={e => { if (onFiles) e.preventDefault(); }} onDrop={e => { if (onFiles) { e.preventDefault(); if (!busy) onFiles(Array.from(e.dataTransfer.files)); } }}>
    {visibleItems.length > 0 && <div className="unified-attachments">{visibleItems.map((item: ComposerItem) => <div className="unified-attachment" key={item.id}>
      {item.preview ? <Image unoptimized width={40} height={40} src={item.preview} alt={item.name} /> : <Icon name="file" size={20} />}
      <span>{item.name}{item.status && <small role="status">{item.status}</small>}</span>
      <button type="button" disabled={busy} aria-label={`Hiq ${item.name}`} onClick={() => item.id.startsWith("url:") ? onChange(value.replaceAll(item.name, "").trim()) : onRemove?.(item.id)}>×</button>
    </div>)}</div>}
    {menu && <div id={`${id}-menu`} className="unified-menu" onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setMenu(false); menuButton.current?.focus(); } }} aria-label="Bashkëngjit materiale">
      {onFiles && <><button type="button" onClick={() => { photo.current?.click(); setMenu(false); }}>Shto foto</button><button type="button" onClick={() => { file.current?.click(); setMenu(false); }}>Shto skedar</button></>}
      <button type="button" onClick={() => { setLink(""); setMenu(false); }}>Shto link</button>
      {onOpen && <button type="button" onClick={() => { onOpen(); setMenu(false); }}>Hap bisedën</button>}
    </div>}
    {link !== null && <div className="unified-link"><label htmlFor={`${id}-link`}>Linku i faqes</label><input id={`${id}-link`} type="url" value={link} maxLength={2048} placeholder="https://…" onChange={e => setLink(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }} /><button type="button" disabled={busy} onClick={addLink}>Shto</button><button type="button" onClick={() => setLink(null)}>Anulo</button>{linkError && <small role="alert">{linkError}</small>}</div>}
    <input hidden ref={file} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.pdf,.txt,.md,.csv,.json" onChange={e => { onFiles?.(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
    <input hidden ref={photo} type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={e => { onFiles?.(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
    <div className="assistant-prompt is-multiline" aria-busy={busy}>
      <button ref={menuButton} type="button" disabled={busy} aria-label="Shto foto, skedar ose link" aria-controls={`${id}-menu`} aria-expanded={menu} onClick={() => setMenu(v => !v)}><Icon name="plus" size={22} /></button>
      <label className="sr-only" htmlFor={id}>Shkruaji Agjentit</label>
      <textarea ref={textarea} id={id} value={value} onChange={e => onChange(e.target.value)} rows={1} enterKeyHint="enter" maxLength={maxLength} placeholder={placeholder} disabled={busy}
        onPaste={e => { if (onFiles && e.clipboardData.files.length) { e.preventDefault(); onFiles(Array.from(e.clipboardData.files)); } }}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !window.matchMedia("(max-width: 760px)").matches) { e.preventDefault(); if (canSend) onSubmit(); } if (e.key === "Escape") { setMenu(false); setLink(null); } }} />
      <div className="assistant-prompt-actions"><button type="button" onClick={onVoice} disabled={busy} aria-label="Dikto me mikrofon"><Icon name="microphone" size={21} /></button>
        {onStop && busy ? <button type="button" className="assistant-prompt-send" onClick={onStop} aria-label="Ndalo pritjen"><Icon name="stop" size={20}/></button> : <button type="button" className="assistant-prompt-send" onClick={onSubmit} disabled={!canSend} aria-label={busy ? "Duke përgatitur përgjigjen" : "Dërgo mesazhin"}>{busy ? <span className="assistant-prompt-spinner"/> : <Icon name="up" size={21}/>}</button>}
      </div>
    </div>{children}
  </div>;
}
