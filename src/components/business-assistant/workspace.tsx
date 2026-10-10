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
import { BusinessAssistant } from "./panel";
import { TalkingRobot } from "./talking-robot";
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
type Workspace = {
  setPageContext: Dispatch<
    SetStateAction<{ path: string; data: CatalogAssistantContext } | null>
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
  launch: (text?: string) => void;
};
const AssistantContext = createContext<Workspace | null>(null);
export const useAssistantWorkspace = () => useContext(AssistantContext);
export function AssistantWorkspaceProvider({
  children,
  slug,
  name,
  modules,
  external,
}: {
  children: ReactNode;
  slug: string;
  name: string;
  modules: string[];
  external: boolean;
}) {
  const pathname = usePathname();
  const sendRef = useRef<(() => void) | null>(null);
  const [open, setOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(440);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"text" | "audio">("text");
  const [pageContext, setPageContext] = useState<{
    path: string;
    data: CatalogAssistantContext;
  } | null>(null);
  const baseContext = contextFromPath(pathname, slug);
  const data = pageContext?.path === pathname ? pageContext.data : undefined;
  const context: AssistantUIContext = {
    ...baseContext,
    ...data,
    ...(baseContext.page === "products" &&
    !baseContext.entityId &&
    data?.selectedEntityIds.length === 1
      ? { entityType: "product" as const, entityId: data.selectedEntityIds[0] }
      : {}),
  };
  const launch = (prompt?: string) => {
    if (prompt !== undefined) setText(prompt);
    setMode("text");
    setOpen(true);
  };
  return (
    <AssistantContext.Provider
      value={{
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
        launch,
      }}
    >
      {children}
    </AssistantContext.Provider>
  );
}
export function useCatalogAssistantContext(data: CatalogAssistantContext) {
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
export function AssistantWorkspaceSurface() {
  const w = useAssistantWorkspace();
  if (!w) return null;
  return (
    <BusinessAssistant
      external={w.external}
      sendRef={w.sendRef}
      slug={w.slug}
      agentName={`Agjenti “${w.name}”`}
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
            <TalkingRobot />
            Agjenti “{w.name}”
          </span>
          <h1>Çfarë do të bëjmë sot?</h1>
          <p>Më trego çfarë dëshiron të përditësosh për biznesin tënd.</p>
        </>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          w.send();
        }}
      >
        <label
          className="sr-only"
          htmlFor={home ? "assistant-home-input" : "assistant-context-input"}
        >
          Kërkesa për Agjentin
        </label>
        <input
          id={home ? "assistant-home-input" : "assistant-context-input"}
          value={w.text}
          onChange={(e) => w.setText(e.target.value)}
          maxLength={12000}
          placeholder={
            home
              ? "Shkruaj çfarë dëshiron të bëjë Agjenti…"
              : `Pyet Agjentin për ${contextLabel(w.context).toLocaleLowerCase()}…`
          }
        />
        <button
          type="button"
          aria-label="Përgjigju me audio"
          onClick={() => {
            w.setMode("audio");
            w.setOpen(true);
          }}
        >
          Audio
        </button>
        <button type="submit">Dërgo kërkesën ↑</button>
      </form>
      <div className="assistant-quick-actions">
        {suggestions.map((s) => (
          <button key={s.label} onClick={() => w.launch(s.text)}>
            {s.label}
            <span aria-hidden="true">↗</span>
          </button>
        ))}
      </div>
      {home && (
        <small>Ti kontrollon propozimin dhe konfirmon çdo ndryshim.</small>
      )}
    </section>
  );
}
