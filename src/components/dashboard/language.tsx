"use client";

import { createContext, useContext, useMemo, useTransition, type ReactNode } from "react";
import { StatusBadge, statusLabels } from "./ui";
import { useRouter } from "next/navigation";
import { LANGUAGE_COOKIE, translator, type DashboardLanguage } from "@/lib/dashboard/language/core";

const LanguageContext = createContext<DashboardLanguage>("sq");
export function DashboardLanguageProvider({ language, children }: { language: DashboardLanguage; children: ReactNode }) {
  return <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>;
}
export function useDashboardLanguage() { return useContext(LanguageContext); }
export function useDashboardTranslator() {
  const language = useDashboardLanguage();
  return useMemo(() => translator(language), [language]);
}
export function DashboardLanguageSwitch() {
  const language = useDashboardLanguage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <div className="dashboard-language-switch" role="group" aria-label="Gjuha / Language" aria-busy={pending}>
    {(["sq", "en"] as const).map(value => <button key={value} type="button" lang={value}
      aria-pressed={language === value} disabled={pending} onClick={() => {
        if (value === language) return;
        document.cookie = `${LANGUAGE_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
        startTransition(() => router.refresh());
      }}><span className="lang-full">{value === "sq" ? "Shqip" : "English"}</span><span className="lang-compact" aria-hidden="true">{value.toUpperCase()}</span></button>)}
  </div>;
}
export function LocalizedStatusBadge({ status }: { status: string }) {
  const t = useDashboardTranslator();
  return <StatusBadge status={status} label={t(statusLabels[status] ?? status)} />;
}
