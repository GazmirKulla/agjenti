"use client";
import { useEffect, useState, type ReactNode } from "react";
import "./agent-space.css";

/**
 * A topic of the Agjenti space: its settings in the middle, the agent's test beside them (open or closed).
 * On a phone one shows at a time; both stay mounted, so switching keeps the topic, unsaved edits and the
 * test conversation. A link to a field (#hours) brings the settings back into view.
 */
export function AgentSpace({ children, test, testLabel = "Provo Agjentin" }: { children: ReactNode; test: ReactNode; testLabel?: string }) {
  const [testOpen, setTestOpen] = useState(true);
  const [view, setView] = useState<"settings" | "test">("settings");
  useEffect(() => {
    const showField = () => {
      if (!window.location.hash) return;
      setView("settings");
      requestAnimationFrame(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "center" }));
    };
    window.addEventListener("hashchange", showField);
    return () => window.removeEventListener("hashchange", showField);
  }, []);
  return <div className={`agent-space ${testOpen ? "with-test" : ""} is-${view}`}>
    <div className="agent-space-switch" role="tablist" aria-label="Pamja">
      <button type="button" role="tab" aria-selected={view === "settings"} onClick={() => setView("settings")}>Konfigurimi</button>
      <button type="button" role="tab" aria-selected={view === "test"} onClick={() => setView("test")}>{testLabel}</button>
    </div>
    <div className="agent-space-main">{children}</div>
    <aside className="agent-space-test" aria-label={testLabel} id="prova">
      <header className="agent-space-test-head">
        <b>{testLabel}</b>
        <button type="button" className="agent-space-toggle" aria-expanded={testOpen} onClick={() => setTestOpen(open => !open)}>{testOpen ? "Mbyll" : "Hap"}</button>
      </header>
      <div className="agent-space-test-body" hidden={!testOpen}>{test}</div>
    </aside>
  </div>;
}
