"use client";

import { useAssistantWorkspace } from "@/components/business-assistant/workspace";
import { AssistantAppearanceForm } from "@/components/business-assistant/personal-assistant";
import s from "./settings.module.css";

export function MigoSettings() {
  const workspace = useAssistantWorkspace();
  if (!workspace) return null;
  return <div className={s.appearance}>
    <AssistantAppearanceForm appearance={workspace.appearance} onSave={workspace.saveAppearance}/>
  </div>;
}
