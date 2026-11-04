"use client";

import { Icon } from "@/components/dashboard/icon";
import { defaultPersonalAssistantName } from "@/lib/business-assistant/identity";
import "./personal-assistant.css";

export function PersonalAssistantAvatar() {
  return <span className="personal-assistant-avatar"><Icon name="spark" size={20} /></span>;
}

export function PersonalAssistantWidget({ hidden, onOpen }: {
  hidden: boolean; onOpen: () => void;
}) {
  return <section className="personal-assistant-widget" hidden={hidden} aria-label="Asistenti yt personal">
    <button type="button" className="personal-assistant-open" onClick={onOpen} aria-label={`Hap bisedën me ${defaultPersonalAssistantName}`}>
      <PersonalAssistantAvatar />
      <strong>{defaultPersonalAssistantName}</strong>
    </button>
  </section>;
}
