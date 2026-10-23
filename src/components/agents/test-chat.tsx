"use client";
import { TestConfiguration } from "./test-configuration";
import { AssistantComposer } from "@/components/business-assistant/composer";
import { MessageRoutingView } from "@/components/workflows/message-routing";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { TestAttachment } from "@/lib/agents/test-chat/attachments";
import { Icon } from "@/components/dashboard/icon";
import { AudioRecorder, primeVoiceCapture } from "@/components/onboarding/audio-recorder";
import { TrainingSession, type TrainingFeedback, type TrainingRequest } from "./training-session";
import { ChatMessage, CopyMessage } from "./chat-message";
import { newConversation, replaySession, readHistory, transcript, type TestConversation, type ChatEntry, type PendingTestTurn, reconcileTestConversation } from "./chat-history";
import "./test-chat.css";
const reasons: Record<string, string> = {
  workflow_not_configured: "Produkti ka nevojë për një workflow.",
  missing_api_key: "AI nuk është konfiguruar. Po shfaqet përgjigjja rezervë.",
  provider_error: "Thirrja AI dështoi. Provo rigjenerimin.",
  empty_reply: "AI nuk ktheu tekst. Provo rigjenerimin.",
};
const initialChat: TestConversation = { id: "initial", title: "Bisedë e re", entries: [], updatedAt: 0 };
type Upload = { id: string; file: File; preview?: string };
export function AgentTestChat({ slug, businessName, userId }: {
  slug: string; businessName: string; userId: string;
}) {
  const [chats, setChats] = useState<TestConversation[]>([initialChat]);
  const [activeId, setActiveId] = useState("initial");
  const [ready, setReady] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [photo, setPhoto] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [retained, setRetained] = useState<TestAttachment[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const [waitStopped, setWaitStopped] = useState(false);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [storageNotice, setStorageNotice] = useState("");
  const [voice, setVoice] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [canSpeak, setCanSpeak] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [trainingRequest, setTrainingRequest] = useState<TrainingRequest | null>(null);
  const [trainingBusy, setTrainingBusy] = useState(false);
  const [trainingFeedback, setTrainingFeedback] = useState<TrainingFeedback | null>(null);
  const chatLog = useRef<HTMLDivElement>(null);
  const focusComposer = () => document.getElementById("agent-test-message")?.focus();

  const retry = useRef<{ index: number; original?: ChatEntry } | null>(null);
  const inFlight = useRef(false);
  const epoch = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const objectUrls = useRef(new Set<string>());
  const chat = chats.find(c => c.id === activeId) ?? chats[0];
  const messages = chat.entries;
  const last = messages.at(-1)?.result ?? null;
  const preparing = pending !== null || trainingBusy || voiceBusy;
  const busy = preparing || Boolean(chat.outbox?.length);
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const storageKey = `agjenti:test-chat:v1:${userId}:${slug}`;
  useEffect(() => {
    try { const saved = readHistory(sessionStorage.getItem(storageKey)); if (saved.length) { setChats(saved); setActiveId(saved[0].id); } }
    catch { setStorageNotice("Historiku ruhet vetëm gjatë kësaj vizite; ruajtja e shfletuesit nuk është e disponueshme."); }
    setCanSpeak("speechSynthesis" in window);
    setReady(true);
  }, [storageKey]);
  useEffect(() => {
    if (!ready) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify(chats, (key, value) => key === "preview" ? undefined : value)); }
    catch { setStorageNotice("Historiku nuk u ruajt: hapësira e shfletuesit është plot. Eksporto bisedat e rëndësishme."); }
  }, [chats, ready, storageKey]);
  useEffect(() => {
    const urls = objectUrls.current;
    const generation = epoch;
    return () => { generation.current++; controller.current?.abort(); for (const url of urls) URL.revokeObjectURL(url); window.speechSynthesis?.cancel(); };
  }, []);
  useEffect(() => {
    function escape(e: KeyboardEvent) { if (e.key === "Escape") setExpanded(false); }
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);

  useEffect(() => {
    if (chatLog.current && !showJump) chatLog.current.scrollTop = chatLog.current.scrollHeight;
  }, [messages.length, pending, phase, activeId, showJump]);
  useEffect(() => {
    if (!ready) return;
    let disposed = false, running = false;
    async function sync() {
      if (disposed || running) return;
      running = true;
      try {
        for (const current of chatsRef.current.filter(c => c.outbox?.length)) {
          const url = `/api/agent-test/turns?slug=${encodeURIComponent(slug)}`;
          const response = await fetch(`${url}&stream=${current.id}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || "Statusi nuk u ngarkua.");
          if (disposed) return;
          const jobs = body.jobs ?? [];
          setChats(all => all.map(c => c.id === current.id ? reconcileTestConversation(c,jobs) : c));
          // One enqueue at a time; processing happens serially in the server
          // queue. Reconcile first when the enqueue response was lost.
          const next = current.outbox?.find(o => !o.accepted && !jobs.some((j: { requestId: string }) => j.requestId === o.id));
          if (!next || next.status !== "queued") continue;
          const posted = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15000),
            body: JSON.stringify({ requestId: next.id, streamId: current.id, sequence: next.sequence, input: { message: next.text, hasMedia: next.photo, session: next.session, attachments: next.attachments.map(a=>a.token) } }) });
          const result = await posted.json();
          if (disposed) return;
          setChats(all => all.map(c => c.id !== current.id ? c : { ...c, outbox: c.outbox?.map(o => o.id !== next.id ? o : { ...o, accepted: posted.ok, status: posted.ok ? "queued" : "failed", error: result.error }) }));
        }
      } catch {
        if (!disposed) setStorageNotice("Lidhja/statusi nuk u konfirmua. Po rakordojmë të njëjtën kërkesë; nuk është dërgim i ri.");
      } finally { running = false; }
    }
    const interval = window.setInterval(() => void sync(), 1000);
    const reconnect = () => void sync();
    window.addEventListener("online", reconnect);
    return () => { disposed = true; clearInterval(interval); window.removeEventListener("online", reconnect); };
  }, [ready, slug]);
  async function retryOperation(operation: PendingTestTurn) {
    try {
      const response = await fetch(`/api/agent-test/turns?slug=${encodeURIComponent(slug)}`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ requestId: operation.id, streamId: chat.id, sequence: operation.sequence, retry: true, input: { message: operation.text, hasMedia: operation.photo, session: operation.session, attachments: operation.attachments.map(a=>a.token) } }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setChats(all => all.map(c => c.id !== chat.id ? c : { ...c, outbox: c.outbox?.map(o => o.id === operation.id ? { ...o, accepted: true, status: "queued", error: undefined } : o) }));
      setWaitStopped(false);
    } catch { setError("Retry nuk u konfirmua. Identiteti i kërkesës ruhet."); }
  }
  function clearComposer(keepPreviews = false) {
    retry.current = null;
    for (const u of uploads) if (u.preview && !keepPreviews) { URL.revokeObjectURL(u.preview); objectUrls.current.delete(u.preview); }
    setDraft(""); setPhoto(false); setUploads([]); setRetained([]); setEditing(null); setError(""); setVoice(false);
  }
  function stop() {
    setWaitStopped(true);
    setStorageNotice("U ndal vetëm pritja vizuale. Puna në server mund të vazhdojë; rezultati do të rakordohet.");
  }
  function reset() {
    const next = newConversation();
    const all = [next, ...chats.filter(x => x.entries.length || x.outbox?.length)];
    if (all.slice(8).some(c => c.outbox?.length)) { setError("Ruajmë bisedat në proces. Fshi një bisedë të përfunduar për të hapur një të re."); return; }
    clearComposer(); setTrainingFeedback(null); setTrainingRequest(null); setWaitStopped(false);
    if (chat.outbox?.length) setStorageNotice("Biseda e mëparshme ruhet në historik. Puna e saj nuk është anuluar.");
    window.speechSynthesis?.cancel(); setSpeaking(null);
    setChats(all.slice(0,8)); setActiveId(next.id); setShowJump(false);
  }
  function selectChat(id: string) {
    if (preparing) return;
    clearComposer(); setActiveId(id); setTrainingFeedback(null); setTrainingRequest(null); setShowJump(false);
    setChats(current => [...current.filter(c=>c.id===id), ...current.filter(c=>c.id!==id)]);
    window.speechSynthesis?.cancel(); setSpeaking(null);
  }
  function saveTitle() {
    if (renaming?.title.trim()) setChats(current=>current.map(c=>c.id===renaming.id ? {...c,title:renaming.title.trim().slice(0,80)} : c));
    setRenaming(null);
  }
  function addFiles(files: File[]) {
    if (pending !== null || trainingBusy || voiceBusy) return;
    const valid: Upload[] = [];
    for (const file of files) {
      if (uploads.length + retained.length + valid.length >= 3) { setError("Deri në 3 skedarë për mesazh."); break; }
      if (!file.size || file.size > 3*1024*1024 || !/\.(png|jpe?g|webp|pdf|txt|md|csv|json)$/i.test(file.name)) { setError("Përdor JPG, PNG, WEBP, PDF, TXT, MD, CSV ose JSON deri në 3 MB."); continue; }
      const preview = /\.(png|jpe?g|webp)$/i.test(file.name) ? URL.createObjectURL(file) : undefined;
      if (preview) objectUrls.current.add(preview);
      valid.push({ id: crypto.randomUUID(), file, preview });
    }
    setUploads(current => [...current, ...valid]);
  }
  function edit(index: number) {
    const entry = messages[index]; clearComposer(); setDraft(entry.text); setPhoto(entry.photo); setRetained(entry.attachments); setEditing(index);
    focusComposer();
  }
  async function send(index = editing ?? messages.length, original?: ChatEntry) {
    const text = original?.text ?? draft.trim();
    const simulated = original?.photo ?? photo;
    const existing = original?.attachments ?? retained;
    const files = original ? [] : uploads;
    if (inFlight.current || trainingBusy || voiceBusy || (!text && !simulated && !existing.length && !files.length)) return;
    index = original || editing !== null ? index : messages.length + (chat.outbox?.length ?? 0);
    if (index >= 40) { setError("Kjo bisedë arriti 40 mesazhe. Fillo një bisedë të re."); return; }
    if (!original) setDraft("");
    setWaitStopped(false);
    const run = ++epoch.current; inFlight.current = true; controller.current = new AbortController();
    setError(""); setShowJump(false); setPendingIndex(index);
    setPending(text || (files.length || existing.length ? "Skedar i bashkëngjitur" : "[Foto e simuluar]"));
    try {
      const attachments = [...existing];
      for (const upload of files) {
        setPhase(`Po lexojmë ${upload.file.name}…`);
        const form = new FormData(); form.set("file", upload.file);
        const response = await fetch(`/api/agent-test/upload?slug=${encodeURIComponent(slug)}`, { method: "POST", body: form, signal: controller.current.signal });
        const body = await response.json();
        if (!response.ok || !body.attachment) throw new Error(body.error || "Skedari nuk u ngarkua.");
        attachments.push({ ...body.attachment, preview: upload.preview });
      }
      const links = [...new Set((text.match(/https?:\/\/[^\s<>"']+/g) ?? []).map(url => url.replace(/[.,;!?)}\]]+$/, "")))].filter(url => !attachments.some(a => a.name === url));
      if (attachments.length + links.length > 3) throw new Error("Shto deri në 3 skedarë ose linke për mesazh.");
      for (const url of links) {
        setPhase("Po lexojmë linkun…");
        const response = await fetch(`/api/agent-test/upload?slug=${encodeURIComponent(slug)}&mode=link&url=${encodeURIComponent(url)}`, { method: "POST", signal: controller.current.signal });
        const body = await response.json();
        if (!response.ok || !body.attachment) throw new Error(body.error || "Linku nuk u lexua.");
        attachments.push(body.attachment);
      }
      if (epoch.current !== run) return;
      // A queued turn may have completed while attachments were prepared.
      // Append to the current reconciled conversation, never the captured one.
      const currentChat = chatsRef.current.find(c => c.id === chat.id) ?? chat;
      const currentEntries = currentChat.entries;
      if (!original && editing === null) index = currentEntries.length + (currentChat.outbox?.length ?? 0);
      if (index >= 40) throw new Error("Kjo bisedë arriti 40 mesazhe. Fillo një bisedë të re.");
      const targetId = index < messages.length || chat.id === "initial" ? crypto.randomUUID() : chat.id;
      const base = index < currentEntries.length ? { ...currentChat, id: targetId, title: `${chat.title.slice(0,55)} · version`, entries: currentEntries.slice(0,index), outbox: [] } : { ...currentChat, id: targetId };
      const operation: PendingTestTurn = { id: crypto.randomUUID(), sequence: index, text, photo: simulated, attachments,
        session: replaySession(currentEntries, Math.min(index, currentEntries.length)), status: "queued" };
      const nextChat = { ...base, outbox: [...(base.outbox ?? []), operation], title: index ? base.title : (text || attachments[0]?.name || "Provë me foto").slice(0,65), updatedAt: Date.now() };
      const allChats = [nextChat, ...chatsRef.current.filter(c => c.id !== targetId && (chat.id !== "initial" || c.id !== "initial"))];
      if (allChats.slice(8).some(c => c.outbox?.length)) throw new Error("Nuk mund të hiqet një bisedë në proces. Fshi një bisedë të përfunduar.");
      const nextChats = allChats.slice(0,8);
      // Persist identity BEFORE any request. Without storage, do not submit an
      // operation that this browser cannot reconcile after reload.
      sessionStorage.setItem(storageKey, JSON.stringify(nextChats, (key,value) => key === "preview" ? undefined : value));
      chatsRef.current = nextChats; setChats(nextChats); setActiveId(targetId);
      setUploads([]); setRetained([]); setPhoto(false); setEditing(null);
      // Do not clear text typed while attachment preparation was in progress.
      retry.current = null;
    } catch (e) {
      if (epoch.current === run) {
        retry.current = { index, original };
        if (!original) setDraft(current => current.trim() ? current : text);
        setError(e instanceof Error ? e.message : "Nuk u lidhëm. Provo përsëri; mesazhi u ruajt këtu.");
      }
    } finally {
      if (epoch.current === run) { inFlight.current = false; setPending(null); setPendingIndex(null); setPhase(""); focusComposer(); }
    }
  }
  async function transcribe(file: File) {
    setVoiceBusy(true); const run = epoch.current;
    try {
      const form = new FormData(); form.set("audio", file); form.set("answers", "{}");
      const response = await fetch(`/api/agent-test/upload?slug=${encodeURIComponent(slug)}&mode=audio`, { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok || !body.transcript) throw new Error(body.error || "Audioja nuk u kthye në tekst.");
      if (run !== epoch.current) return;
      if ((draft + body.transcript).length + 1 > 2000) throw new Error("Teksti dhe audioja së bashku kalojnë 2,000 karaktere. Shkurto draftin.");
      setDraft(current => [current,body.transcript].filter(Boolean).join("\n")); setVoice(false);
    } finally { setVoiceBusy(false); }
  }
  function speak(entry: ChatEntry) {
    window.speechSynthesis.cancel();
    if (speaking === entry.id) { setSpeaking(null); return; }
    const utterance = new SpeechSynthesisUtterance(entry.result.reply); utterance.lang = "sq-AL";
    utterance.onend = utterance.onerror = () => setSpeaking(null);
    setSpeaking(entry.id); window.speechSynthesis.speak(utterance);
  }
  function download() {
    const url = URL.createObjectURL(new Blob([transcript(chat)], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a"); a.href=url; a.download="biseda-e-proves.txt"; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  return <section className={`agent-test chat-workspace ${expanded ? "is-expanded" : ""}`}>
    <header className="chat-header">
      <div><span className="agent-test-label"><span /> AGJENTI YT · PROVË</span><h2>{businessName}</h2></div>
      <nav aria-label="Veprimet e bisedës">
        <button className="chat-icon" type="button" title="Historiku" aria-label="Historiku i bisedave" aria-expanded={showHistory} onClick={() => setShowHistory(v=>!v)}><Icon name="history" /></button>
        <button className="chat-icon" type="button" title="Eksporto bisedën" aria-label="Eksporto bisedën" disabled={!messages.length || busy} onClick={download}><Icon name="download" /></button>
        <button className="chat-icon" type="button" title="Zgjero / zvogëlo" aria-label="Zgjero bisedën" aria-pressed={expanded} onClick={()=>setExpanded(v=>!v)}><Icon name="expand" /></button>
        <button className="chat-toolbar-button" type="button" aria-expanded={showDetails} onClick={()=>setShowDetails(v=>!v)}><Icon name="workflows" size={17}/> Rrjedha</button>
        <button className="chat-toolbar-button primary" type="button" disabled={preparing || voice} onClick={reset}><Icon name="plus" size={17}/> Bisedë e re</button>
      </nav>
    </header>
    <div className="chat-safety-note">Provë private · Nuk dërgon mesazhe në Instagram dhe nuk krijon porosi reale.</div>
    {last?.setupTestPassed && <p className="chat-status" role="status">✓ Prova u ruajt. <Link href={`/b/${slug}`}>Kthehu te Dashboard →</Link></p>}
    <div className={`chat-body ${showHistory ? "with-history" : ""} ${showDetails ? "with-details" : ""}`}>
      {showHistory && <aside className="chat-history" aria-label="Historiku">
        <h3>Bisedat e tua</h3><input aria-label="Kërko bisedat" placeholder="Kërko bisedat…" value={search} onChange={e=>setSearch(e.target.value)}/>
        <p>8 bisedat e fundit në këtë skedë të shfletuesit.</p>
        {chats.filter(c => (c.title + c.entries.map(e=>e.text+e.result.reply).join(" ")).toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(c => <div className={`chat-history-row ${c.id===chat.id ? "active" : ""}`} key={c.id}>
          {renaming?.id === c.id ? <input autoFocus aria-label="Emri i bisedës" maxLength={80} value={renaming.title} onChange={e=>setRenaming({...renaming,title:e.target.value})} onBlur={saveTitle} onKeyDown={e=>{if(e.key==="Enter")saveTitle();if(e.key==="Escape")setRenaming(null);}}/> : <button disabled={preparing || voice} onClick={()=>selectChat(c.id)} type="button" aria-current={c.id===chat.id ? "true" : undefined}><span>{c.title}</span><small>{c.entries.length} mesazhe</small></button>}
          <button className="chat-icon" type="button" title="Riemërto bisedën" aria-label={`Riemërto ${c.title}`} disabled={busy || voice} onClick={()=>setRenaming({id:c.id,title:c.title})}><Icon name="edit" size={14}/></button>
          <button className="chat-icon" type="button" title="Fshi bisedën" aria-label={`Fshi ${c.title}`} disabled={busy || voice} onClick={()=>{
            const next=chats.filter(x=>x.id!==c.id); const fallback=next.length ? next : [newConversation()]; setChats(fallback); if(c.id===activeId) { clearComposer(); setActiveId(fallback[0].id); setTrainingFeedback(null); setTrainingRequest(null); window.speechSynthesis?.cancel(); setSpeaking(null); }
          }}><Icon name="trash" size={14}/></button>
        </div>)}
      </aside>}
      <div className="agent-test-conversation">
        {storageNotice && <p role="status">{storageNotice}</p>}
        {last && <TestConfiguration configuration={last.configuration} slug={slug} agentConfigured={last.debug.agentConfigured} />}
        <div className="agent-test-log" ref={chatLog} role="log" aria-label="Biseda e provës" aria-live="polite" onScroll={e=>{ const el=e.currentTarget; setShowJump(el.scrollHeight-el.scrollTop-el.clientHeight>120); }}>
          {!messages.length && !pending && !chat.outbox?.length && <div className="agent-test-empty"><div className="chat-welcome-icon"><Icon name="spark" size={30}/></div><span>PROVO AGJENTIN TËND</span><h3>Si do ta nisë klienti bisedën?</h3><p>Pyet, dërgo një foto ose fol. Shiko si përgjigjet agjenti dhe përmirësoje gjatë bisedës.</p><div className="chat-suggestions">{["Çfarë produktesh keni?","Dua të bëj një porosi","Si mund të flas me stafin?"].map(text=><button type="button" key={text} onClick={()=>{setDraft(text);focusComposer();}}>{text}<Icon name="arrow" size={15}/></button>)}</div></div>}
          {(pendingIndex !== null ? messages.slice(0,pendingIndex) : messages).map((entry,index)=><div className="chat-exchange" key={entry.id}>
            <div className="agent-test-bubble customer"><p>{entry.text}</p>{entry.photo && <span className="chat-file-pill">Foto e simuluar</span>}{entry.attachments.map((a,i)=><span className="chat-file-pill" key={i}>{a.preview?.startsWith("blob:") ? <Image unoptimized width={80} height={80} src={a.preview} alt={a.name}/> : <Icon name="file" size={15}/>} {a.name}</span>)}</div>
            <small className="chat-receipt">Përpunuar · provë lokale</small>
            <div className="chat-message-actions customer"><CopyMessage text={entry.text}/><button type="button" className="chat-icon" aria-label="Ndrysho mesazhin" title="Ndrysho mesazhin" disabled={busy || voice} onClick={()=>edit(index)}><Icon name="edit" size={16}/></button></div>
            <div className="agent-test-bubble agent"><span className="chat-agent-avatar"><Icon name="spark" size={19}/></span><ChatMessage text={entry.result.reply}/></div>
            <div className="chat-message-actions"><CopyMessage text={entry.result.reply}/><button className="chat-icon" type="button" title="Rigjenero përgjigjen" aria-label="Rigjenero përgjigjen" disabled={busy || voice} onClick={()=>void send(index,entry)}><Icon name="refresh" size={16}/></button>{canSpeak && <button className="chat-icon" type="button" title={speaking===entry.id ? "Ndalo leximin" : "Lexo me zë"} aria-label={speaking===entry.id ? "Ndalo leximin" : "Lexo me zë"} onClick={()=>speak(entry)}><Icon name={speaking===entry.id ? "stop" : "volume"} size={16}/></button>}{entry.result.trainingReceipt && <button type="button" className="chat-train" disabled={busy || voice} onClick={()=>{
              const feedback={receipt:entry.result.trainingReceipt!,question:entry.text || "[Skedar]",response:entry.result.reply,workflowId:entry.result.workflowId,stepKey:entry.result.nextState.step_key??null}; setTrainingFeedback(feedback);setTrainingRequest(previous=>({key:(previous?.key??0)+1,feedback}));
            }}><Icon name="spark" size={14}/> Përmirëso</button>}</div>
          </div>)}
          {chat.outbox?.map(operation => <div className="chat-exchange" key={operation.id}>
            <div className="agent-test-bubble customer"><p>{operation.text || "[Skedar/foto prove]"}</p></div>
            <small className="chat-receipt">{operation.status === "processing" ? "AI po përpunon · provë lokale" : operation.status === "failed" ? "Nuk u përfundua" : "Në radhë · provë lokale"}</small>
            {operation.status === "processing" && !waitStopped && <p role="status">Duke pritur përgjigjen e AI-së…</p>}
            {operation.error && <p role="alert">{operation.error}</p>}
            {operation.status === "failed" && <button type="button" onClick={()=>void retryOperation(operation)}>Provo përsëri të njëjtën kërkesë</button>}
          </div>)}
          {Boolean(chat.outbox?.length) && !waitStopped && <button type="button" onClick={stop}>Ndalo pritjen</button>}
          {pending !== null && <div className="chat-exchange"><div className="agent-test-bubble customer"><p>{pending}</p></div><small className="chat-receipt">Po përgatitet lokalisht</small>{phase && !phase.startsWith("Agjenti") ? <p className="agent-test-thinking" role="status"><span className="chat-thinking-dot"/>{phase}</p> : <p role="status">Po përgatitet mesazhi lokalisht…</p>}</div>}
        </div>
        {showJump && <button className="chat-jump chat-icon" type="button" aria-label="Shko te mesazhi i fundit" onClick={()=>{setShowJump(false);chatLog.current?.scrollTo({top:chatLog.current.scrollHeight,behavior:"smooth"});}}><Icon name="down" size={18}/></button>}
        <form className="agent-test-composer" onSubmit={e=>{e.preventDefault();void send();}}>
          {editing !== null && <div className="chat-edit-notice"><span>Po ndryshon mesazhin {editing+1}. Origjinali ruhet si bisedë më vete.</span><button type="button" className="chat-icon" aria-label="Anulo ndryshimin" disabled={busy} onClick={()=>clearComposer()}><Icon name="close" size={16}/></button></div>}
          {voice ? <AudioRecorder busy={voiceBusy} variant="assistant" purpose="request" onAnalyze={transcribe} onBack={()=>setVoice(false)}/> : <AssistantComposer
            id="agent-test-message" value={draft} onChange={setDraft} maxLength={2000} placeholder="Shkruaj një mesazh si klient…"
            busy={trainingBusy || voiceBusy} onSubmit={()=>void send()} onVoice={()=>{ primeVoiceCapture(); setVoice(true); }} onFiles={addFiles}
            canSubmit={Boolean(draft.trim() || photo || uploads.length || retained.length)}
            items={[...uploads.map(u=>({id:u.id,name:u.file.name,preview:u.preview})), ...retained.map((a,i)=>({id:`retained-${i}`,name:a.name}))]}
            onRemove={id=>{if(id.startsWith("retained-")) setRetained(current=>current.filter((_,i)=>`retained-${i}`!==id)); else setUploads(current=>current.filter(u=>{if(u.id!==id)return true;if(u.preview){URL.revokeObjectURL(u.preview);objectUrls.current.delete(u.preview);}return false;}));}}
          />}
          <div className="chat-composer-tools"><label className="agent-test-photo"><input type="checkbox" checked={photo} disabled={busy || voice} onChange={e=>setPhoto(e.target.checked)}/> Simulo foto</label><span className="chat-character-count">{draft.length ? `${draft.length}/2000` : ""}</span></div>
          {error && <p className="agent-test-error" role="alert">{error} <button type="button" disabled={busy} onClick={()=>void send(retry.current?.index ?? editing ?? messages.length, retry.current?.original)}>Provo përsëri</button></p>}
          <p className="agent-test-disclaimer">Enter për dërgim · Shift + Enter për rresht të ri · Foto, PDF, TXT, MD, CSV, JSON · 3 skedarë, 3 MB secili. Skedarët dhe audioja përpunohen nga AI; përdor të dhëna prove.</p>
        </form>
      </div>
        {showDetails && <aside className="agent-test-debug">
          {last?.setupNotice && <p className="agent-test-notice" role="status">{last.setupNotice}</p>}
          {last && <MessageRoutingView trace={last.visualWorkflow} state={last.nextState} routing={last.conversationRouting} message={messages.at(-1)?.text} />}
          <h3>{last?.conversationRouting ? "Rrjedha e bisedës" : "Workflow i porosisë"}</h3>
          {!last ? (
            <p className="agent-test-disclaimer">
              Pas mesazhit të parë shfaqen hapat: çfarë u plotësua dhe çfarë
              mungon.
            </p>
          ) : (
            <ol className="agent-test-steps" aria-label="Hapat e porosisë">
              {(last.workflowProgress ?? []).map((step) => (
                <li
                  key={step.key}
                  className={`agent-test-step is-${step.status}`}
                >
                  <span className="agent-test-step-mark" aria-hidden>
                    {step.status === "done"
                      ? "✓"
                      : step.status === "current"
                        ? "●"
                        : "○"}
                  </span>
                  <div>
                    <strong>{step.label}</strong>
                    <small>
                      {step.status === "done"
                        ? "U plotësua"
                        : step.status === "current"
                          ? "Hapi aktual — përgjigju këtu"
                          : "Në pritje"}
                      {step.value ? ` · ${step.value}` : ""}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <dl>
            <div>
              <dt>Produkti</dt>
              <dd>{last?.productName || "—"}</dd>
            </div>
            <div>
              <dt>Hapi aktual</dt>
              <dd>{last?.visualWorkflow ? last.visualWorkflow.graph.nodes.find(n => n.id === last.visualWorkflow?.state.nodeId)?.label : last?.nextState.step_key || "Në pritje të mesazhit"}</dd>
            </div>
            <div>
              <dt>Mesazhe prove</dt>
              <dd>{last?.turns || 0} / 40</dd>
            </div>
            <div>
              <dt>Burimi i përgjigjes</dt>
              <dd>
                {last
                  ? last.debug.source === "ai"
                    ? "Inteligjenca artificiale"
                    : last.debug.fallbackReason === "workflow_prompt" ? "Workflow" : "Përgjigje rezervë"
                  : "—"}
              </dd>
            </div>
            {last && (
              <>
                <div>
                  <dt>Koha e përgjigjes</dt>
                  <dd>{(last.debug.elapsedMs / 1000).toFixed(1)} sek</dd>
                </div>
                <div>
                  <dt>Dërgimi automatik</dt>
                  <dd>
                    {last.autoReplyEnabled ? "Aktiv" : "Joaktiv"} · jo në provë
                  </dd>
                </div>
              </>
            )}
          </dl>
          {last?.debug.fallbackReason && last.debug.fallbackReason !== "workflow_prompt" && (
            <p role="status" className="agent-test-notice">
              {reasons[last.debug.fallbackReason] ||
                "U përdor përgjigjja rezervë."}
            </p>
          )}
          {last && !last.nextState.product_id && (!last.visualWorkflow || last.visualWorkflow.graph.nodes.find(n => n.id === last.visualWorkflow?.state.nodeId)?.kind === "product") && (
            <p className="agent-test-notice">
              Produkti nuk u njoh ende. Shkruaj emrin e saktë nga katalogu (p.sh.
              emri i produktit).
            </p>
          )}
          {last?.turns === 40 && (
            <p className="agent-test-notice">
              U arritën 40 mesazhe. Fillo një bisedë të re për të vazhduar.
            </p>
          )}
          <details>
            <summary>Të dhënat e mbledhura (JSON)</summary>
            <pre>
              {JSON.stringify(
                last?.nextState ?? {
                  step_key: "choose_product",
                  fields: {},
                  customer: {},
                },
                null,
                2,
              )}
            </pre>
          </details>
          <p className="agent-test-disclaimer">
            Fotoja e simuluar teston vetëm hapin e workflow-t. Nuk ngarkohet apo
            analizohet një imazh.
          </p>
        </aside>}
    </div>
    <TrainingSession target={{ slug }} feedback={trainingFeedback} request={trainingRequest} memoryHref={`/b/${slug}/agents/memory`} busy={busy || voice} onBusyChange={setTrainingBusy} onChanged={reset} />
  </section>;
}
