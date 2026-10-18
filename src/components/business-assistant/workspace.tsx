"use client";
import {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react";
import { usePathname } from "next/navigation";
import { useMaterialDraft } from "./materials";
import { BusinessAssistant } from "./panel";
import { useAssistantAppearance } from "./personal-assistant";
import type { AssistantAppearance } from "./appearance";
import { AssistantComposer } from "./composer";
import { primeVoiceCapture } from "@/components/onboarding/audio-recorder";
import {
  assistantSuggestions,
  contextFromPath,
  contextLabel,
  type AssistantUIContext,
} from "@/lib/business-assistant/context";

export type CatalogAssistantContext = {
  searchQuery: string;
  filters: { status: string };
  selectedEntityIds: string[];
};
type PageAssistantContext = Partial<CatalogAssistantContext> & Pick<AssistantUIContext, "workflowSelection" | "entityId" | "entityType">;
type Workspace = ReturnType<typeof useMaterialDraft> & {
  setPageContext: Dispatch<
    SetStateAction<{ path: string; data: PageAssistantContext } | null>
  >;
  send: () => void;
  sendRef: React.RefObject<(() => void) | null>;
  slug: string;
  panelWidth: number;
  setPanelWidth: Dispatch<SetStateAction<number>>;
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  text: string;
  setText: Dispatch<SetStateAction<string>>;
  mode: "text" | "audio";
  setMode: Dispatch<SetStateAction<"text" | "audio">>;
  context: AssistantUIContext;
  modules: string[];
  external: boolean;
  name: string;
  appearance: AssistantAppearance;
  saveAppearance: (value: AssistantAppearance) => string | null;
  launch: (text?: string) => void;
  requestKey: number;
  userId: string;
  userName?: string;
  historyOpen: boolean;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
  resetRef: React.RefObject<(() => void) | null>;
};
const AssistantContext = createContext<Workspace | null>(null);
export const useAssistantWorkspace = () => useContext(AssistantContext);
export function AssistantWorkspaceProvider({
  children,
  slug,
  name,
  modules,
  external,
  userId,
  userName,
}: {
  children: ReactNode;
  slug: string;
  name: string;
  modules: string[];
  external: boolean;
  userId: string;
  userName?: string;
}) {
  const materialDraft = useMaterialDraft();
  const { appearance, save: saveAppearance } = useAssistantAppearance(userId, slug);
  const pathname = usePathname();
  const sendRef = useRef<(() => void) | null>(null);
  const resetRef = useRef<(() => void) | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [requestKey, setRequestKey] = useState(0);
  const [panelWidth, setPanelWidth] = useState(440);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"text" | "audio">("text");
  const [pageContext, setPageContext] = useState<{
    path: string;
    data: PageAssistantContext;
  } | null>(null);
  const baseContext = contextFromPath(pathname, slug);
  const data = pageContext?.path === pathname ? pageContext.data : undefined;
  const context: AssistantUIContext = {
    ...baseContext,
    ...data,
    ...(baseContext.page === "products" &&
    !baseContext.entityId &&
    data?.selectedEntityIds?.length === 1
      ? { entityType: "product" as const, entityId: data.selectedEntityIds[0] }
      : {}),
  };
  const launch = (prompt?: string) => {
    if (prompt !== undefined) { setText(prompt); setRequestKey(key => key + 1); }
    setMode("text");
    setOpen(true);
  };
  return (
    <AssistantContext.Provider
      value={{
        ...materialDraft,
        setPageContext,
        send: () => sendRef.current?.(),
        sendRef,
        slug,
        panelWidth,
        setPanelWidth,
        open,
        setOpen,
        text,
        setText,
        mode,
        setMode,
        context,
        modules,
        external,
        name,
        appearance, saveAppearance,
        launch,
        requestKey,
        userId, userName, historyOpen, setHistoryOpen, resetRef,
      }}
    >
      {children}
    </AssistantContext.Provider>
  );
}
export function usePageAssistantContext(data: PageAssistantContext) {
  const workspace = useAssistantWorkspace();
  const setter = workspace?.setPageContext;
  const path = usePathname();
  const serialized = JSON.stringify(data);
  useEffect(() => {
    setter?.({ path, data: JSON.parse(serialized) });
    return () =>
      setter?.((current) => (current?.path === path ? null : current));
  }, [path, serialized, setter]);
}
export function useCatalogAssistantContext(data: CatalogAssistantContext) { usePageAssistantContext(data); }
export function useWorkflowAssistantContext(selection: NonNullable<AssistantUIContext["workflowSelection"]>) { usePageAssistantContext({ workflowSelection: selection }); }
export function AssistantWorkspaceSurface() {
  const w = useAssistantWorkspace();
  if (!w) return null;
  return (
    <BusinessAssistant
      materialDraft={w}
      userId={w.userId}
      userName={w.userName}
      historyOpen={w.historyOpen}
      onHistoryClose={() => w.setHistoryOpen(false)}
      resetRef={w.resetRef}
      external={w.external}
      requestKey={w.requestKey}
      sendRef={w.sendRef}
      slug={w.slug}
      agentName={w.appearance.name}
      businessName={w.name}
      appearance={w.appearance}
      saveAppearance={w.saveAppearance}
      modules={w.modules}
      open={w.open}
      onOpen={() => w.setOpen(true)}
      onClose={() => w.setOpen(false)}
      text={w.text}
      setText={w.setText}
      mode={w.mode}
      setMode={w.setMode}
      context={w.context}
      panelWidth={w.panelWidth}
      setPanelWidth={w.setPanelWidth}
    />
  );
}
export function AssistantEntry({ home = false }: { home?: boolean }) {
  const w = useAssistantWorkspace();
  if (!w) return null;
  const suggestions = assistantSuggestions(w.context, w.modules, w.external);
  if (!home && !suggestions.length) return null;
  return (
    <section
      className={home ? "assistant-home-workspace" : "assistant-context-entry"}
      aria-label={
        home ? "Hapësira e Agjentit" : `Agjenti · ${contextLabel(w.context)}`
      }
    >
      {home && (
        <>
          <span className="assistant-home-identity">
            {w.appearance.name} · Asistenti yt
          </span>
          <div className="assistant-presence" aria-hidden="true"><span /><span /><span /></div>
          <h1>Çfarë do të bëjmë sot?</h1>
        </>
      )}
      <AssistantComposer id={home ? "assistant-home-input" : "assistant-context-input"}
        items={w.materials} onFiles={w.addFiles} onLink={w.addLink} onRemove={w.removeMaterial} busy={w.sending}
        value={w.text} onChange={w.setText} onSubmit={w.send}
        placeholder={home ? "Pyet ose kërko një ndryshim…" : `Pyet për ${contextLabel(w.context).toLocaleLowerCase()}…`}
        onVoice={() => { primeVoiceCapture(); w.setMode("audio"); w.setOpen(true); }} />
      {w.materialError && <p className="assistant-error" role="alert">{w.materialError}</p>}
      <div className="assistant-quick-actions">
        {suggestions.map((s) => (
          <button key={s.label} onClick={() => w.launch(s.text)}>
            {s.label}
            <span aria-hidden="true">↗</span>
          </button>
        ))}
      </div>
      {home && (
        <small>Ndryshimet i konfirmon ti.</small>
      )}
    </section>
  );
}
