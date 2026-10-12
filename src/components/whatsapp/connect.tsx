"use client";
import { useDashboardTranslator } from "@/components/dashboard/language";
import Script from "next/script";
import { Icon } from "@/components/dashboard/icon";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
type FacebookSDK = {
  init: (options: Record<string, unknown>) => void;
  login: (callback: (response: { authResponse?: { code?: string } }) => void, options: Record<string, unknown>) => void;
};
declare global { interface Window { FB?: FacebookSDK } }
export function WhatsAppConnect({ businessId, appId, configId, version, connected, compact = false }: { businessId: string; appId: string; configId: string; version: string; connected: boolean; compact?: boolean }) {
  const t = useDashboardTranslator();
  const router = useRouter();
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [active, setActive] = useState(false), [code, setCode] = useState("");
  const [assets, setAssets] = useState<{ phoneId: string; wabaId: string } | null>(null);
  const [pin, setPin] = useState("");
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (!active || !["https://www.facebook.com", "https://web.facebook.com"].includes(event.origin)) return;
      let data;
      try { data = typeof event.data === "string" ? JSON.parse(event.data) : event.data; } catch { return; }
      if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (data.event === "FINISH" && /^\d+$/.test(data.data?.phone_number_id) && /^\d+$/.test(data.data?.waba_id)) {
        setAssets({ phoneId: data.data.phone_number_id, wabaId: data.data.waba_id });
      } else if (data.event === "CANCEL" || data.event === "ERROR") { setActive(false); setNotice("Lidhja nuk u përfundua. Provo përsëri."); }
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [active, t]);
  async function save() {
    setBusy(true); setNotice("");
    try {
      const response = await fetch(`/api/businesses/${businessId}/whatsapp/connect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, ...assets, pin }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setCode(""); setAssets(null); setPin(""); setActive(false); setNotice("WhatsApp u lidh me sukses."); router.refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Lidhja dështoi."); setCode(""); setAssets(null); setActive(false); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true);
    try {
      const response = await fetch(`/api/businesses/${businessId}/whatsapp/disconnect`, { method: "POST" });
      if (!response.ok) throw new Error();
      setNotice("WhatsApp u shkëput nga Agjenti."); router.refresh();
    } catch { setNotice("Shkëputja dështoi. Provo përsëri."); } finally { setBusy(false); }
  }
  return <div className={compact ? "space-y-4" : "mt-6 flex flex-wrap items-center gap-5"}>
    {appId && configId && <Script src="https://connect.facebook.net/en_US/sdk.js" strategy="afterInteractive" onReady={() => { window.FB?.init({ appId, version, xfbml: false }); setReady(Boolean(window.FB)); }} onError={() => setNotice(t("Nuk u ngarkua Meta. Provo përsëri ose kontrollo bllokuesin e reklamave."))} />}
    {!appId || !configId ? <>{compact && <button className="btn btn-primary" disabled><Icon name="plus" size={18} />{t("Lidh WhatsApp")}</button>}<p className="muted-copy">{compact ? t("Lidhja nuk është ende e disponueshme.") : t("Lidhja me Meta po përgatitet. Administratori duhet të aktivizojë WhatsApp për këtë aplikacion.")}</p></> : <button className="btn btn-primary" disabled={!ready || busy} onClick={() => {
      setCode(""); setAssets(null); setNotice(""); setActive(true);
      window.FB?.login(response => {
        if (response.authResponse?.code) setCode(response.authResponse.code);
        else { setActive(false); setNotice(t("Autorizimi nuk u përfundua.")); }
      }, { config_id: configId, response_type: "code", override_default_response_type: true, extras: { setup: {}, sessionInfoVersion: "3" } });
    }}><Icon name="plus" size={18} />{connected ? t("Rilidh WhatsApp") : t("Lidh WhatsApp")}</button>}
    {code && assets && <div className="w-full space-y-3">
      <label className="block">{t("PIN-i i verifikimit me dy hapa (6 shifra)")}<input className="field-input" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ""))} />
      </label>
      <p className="muted-copy">{t("Përdor PIN-in ekzistues të numrit, ose cakto një PIN të ri nëse numri nuk ka ende një të tillë.")}</p>
      <button className="btn btn-primary" disabled={busy || pin.length !== 6} onClick={save}>{busy ? t("Po lidhet…") : t("Përfundo lidhjen")}</button>
    </div>}
    {connected && <button className="btn btn-ghost text-danger" disabled={busy} onClick={disconnect}>{t("Shkëput WhatsApp")}</button>}
    {notice && <p className="w-full" role="status">{t(notice)}</p>}
  </div>;
}
