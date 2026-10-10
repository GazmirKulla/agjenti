"use client";

import {
  useId,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Icon } from "@/components/dashboard/icon";

const TABS = [
  { id: "profile", label: "Profili", icon: "businesses" },
  { id: "data", label: "Të dhënat", icon: null },
  { id: "modules", label: "Modulet", icon: null },
  { id: "catalog", label: "Katalogu", icon: null },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function SettingsTabs({
  panels,
  aside,
}: {
  panels: Record<TabId, ReactNode>;
  aside: ReactNode;
}) {
  const baseId = useId();
  const [active, setActive] = useState<TabId>("profile");

  function onTabsKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = TABS.findIndex((tab) => tab.id === active);
    if (index < 0) return;
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (index + 1) % TABS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (index - 1 + TABS.length) % TABS.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = TABS.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    setActive(TABS[next].id);
    document.getElementById(`${baseId}-tab-${TABS[next].id}`)?.focus();
  }

  return (
    <>
      <div
        className="settings-tabs"
        role="tablist"
        aria-label="Seksionet e cilësimeve"
        onKeyDown={onTabsKeyDown}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            id={`${baseId}-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            aria-controls={`${baseId}-panel-${tab.id}`}
            tabIndex={active === tab.id ? 0 : -1}
            onClick={() => setActive(tab.id)}
          >
            {tab.icon ? <Icon name={tab.icon} size={16} /> : null}
            {tab.label}
          </button>
        ))}
      </div>
      <div className="configuration-layout">
        <div className="settings-tab-panels">
          {TABS.map((tab) => (
            <div
              key={tab.id}
              id={`${baseId}-panel-${tab.id}`}
              role="tabpanel"
              aria-labelledby={`${baseId}-tab-${tab.id}`}
              hidden={active !== tab.id}
            >
              {panels[tab.id]}
            </div>
          ))}
        </div>
        <aside className="settings-side">{aside}</aside>
      </div>
    </>
  );
}
