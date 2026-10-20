"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/dashboard/icon";
import { readPersonalAssistantName } from "@/lib/business-assistant/identity";
import { TalkingRobot } from "./talking-robot";
import { appearanceStorageKey, assistantActivity, assistantAvatars, defaultAppearance, parseAppearance, type AssistantAppearance } from "./appearance";
import "./personal-assistant.css";

export function useAssistantAppearance(userId: string, slug: string) {
  const key = appearanceStorageKey(userId, slug);
  const [stored, setStored] = useState({ key: "", value: defaultAppearance });
  useEffect(() => {
    const read = () => {
      try { setStored({ key, value: parseAppearance(localStorage.getItem(key)) }); }
      catch { setStored({ key, value: defaultAppearance }); }
    };
    read();
    const sync = (event: StorageEvent) => { if (event.key === key || event.key === null) read(); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [key]);
  return {
    appearance: stored.key === key ? stored.value : defaultAppearance,
    save(value: AssistantAppearance) {
      const name = readPersonalAssistantName(value.name);
      if (!name) return "Emri duhet të ketë 1–32 karaktere në një rresht.";
      try {
        const appearance = { ...value, name };
        localStorage.setItem(key, JSON.stringify(appearance));
        setStored({ key, value: appearance });
        return null;
      } catch { return "Shfletuesi nuk lejoi ruajtjen. Cilësimet nuk u ndryshuan."; }
    },
  };
}

export function PersonalAssistantAvatar({ avatar }: Pick<AssistantAppearance, "avatar">) {
  return <span className="personal-assistant-avatar" data-avatar={avatar}><TalkingRobot /></span>;
}

export function PersonalAssistantWidget({ appearance, hidden, busy, awaitingApproval, onOpen, onSettings }: {
  appearance: AssistantAppearance; hidden: boolean; busy: boolean; awaitingApproval: boolean;
  onOpen: () => void; onSettings: () => void;
}) {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);
  const status = assistantActivity(online, busy, awaitingApproval);
  return <section className="personal-assistant-widget" hidden={hidden} data-activity={status.kind} aria-label="Asistenti yt personal">
    <button type="button" className="personal-assistant-open" onClick={onOpen} aria-label={`Hap bisedën me ${appearance.name}`}>
      <PersonalAssistantAvatar avatar={appearance.avatar} />
      <span className="personal-assistant-copy"><span className="personal-assistant-eyebrow">ASISTENTI YT</span><strong>{appearance.name}</strong>
        <span className="personal-assistant-status" role="status"><i aria-hidden="true" />{status.label}</span>
      </span>
    </button>
    <button type="button" className="personal-assistant-settings" onClick={onSettings} aria-label="Personalizo asistentin" title="Personalizo asistentin"><Icon name="settings" size={17} /></button>
  </section>;
}

export function AssistantAppearanceDialog({ appearance, onSave, onClose }: {
  appearance: AssistantAppearance; onSave: (value: AssistantAppearance) => string | null; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className="personal-assistant-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-scope`} onCancel={onClose}>
    <AssistantAppearanceForm appearance={appearance} onSave={onSave} onClose={onClose} id={id}/>
  </dialog>;
}

export function AssistantAppearanceForm({ appearance, onSave, onClose, id: providedId }: {
  appearance: AssistantAppearance; onSave: (value: AssistantAppearance) => string | null; onClose?: () => void; id?: string;
}) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const [draft, setDraft] = useState(appearance);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => { setDraft(appearance); }, [appearance]);
  return <form onChange={() => setSaved(false)} onSubmit={event => {
      event.preventDefault();
      if (!draft.name.trim()) { setError("Shkruaj një emër për asistentin."); return; }
      const failure = onSave({ ...draft, name: draft.name.trim() });
      if (failure) setError(failure); else { setError(""); setSaved(true); onClose?.(); }
    }}>
      <header><div><span className="personal-assistant-eyebrow">PAK MË PERSONAL</span><h2 id={`${id}-title`}>Asistenti yt, në stilin tënd.</h2></div>
        {onClose && <button type="button" className="personal-assistant-settings" onClick={onClose} aria-label="Mbyll personalizimin">×</button>}
      </header>
      <div className="personal-assistant-preview"><PersonalAssistantAvatar avatar={draft.avatar} /><strong>{draft.name.trim() || "Asistenti yt"}</strong></div>
      <label className="personal-assistant-name">Emri i asistentit<input autoComplete="off" value={draft.name} maxLength={32} required onChange={event => { setDraft({ ...draft, name: event.target.value }); setError(""); }} /></label>
      <fieldset><legend>Ngjyra e avatarit</legend><div className="personal-assistant-options">{assistantAvatars.map(avatar => <label key={avatar.id}>
        <input type="radio" name={`${id}-avatar`} value={avatar.id} checked={draft.avatar === avatar.id} onChange={() => setDraft({ ...draft, avatar: avatar.id })} />
        <span><PersonalAssistantAvatar avatar={avatar.id} />{avatar.label}</span>
      </label>)}</div></fieldset>
      <p id={`${id}-scope`}>Vetëm për ty, në këtë shfletues dhe për këtë biznes. Nuk ndryshon agjentët që flasin me klientët.</p>
      {error && <p role="alert" className="assistant-error">{error}</p>}
      {saved && <p role="status">Pamja u ruajt në këtë shfletues.</p>}
      <footer>{onClose && <button type="button" className="assistant-secondary" onClick={onClose}>Anulo</button>}<button type="submit" className="assistant-primary">Ruaj pamjen</button></footer>
    </form>;
}
