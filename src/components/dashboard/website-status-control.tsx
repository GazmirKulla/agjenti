"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useDashboardTranslator } from "@/components/dashboard/language";

type Status = { key: string; label: string };
type Answer = { status?: string | null; statusLabel?: string | null; statuses?: Status[]; error?: string; uncertain?: boolean };

/**
 * The order's status on the business website and, on request, a change to another of its statuses.
 * The new status is shown only after the website confirms it.
 */
export function WebsiteStatusControl({ businessId, orderId, initial }: { businessId: string; orderId: string; initial: Status | null }) {
  const t = useDashboardTranslator();
  const router = useRouter();
  const url = `/api/businesses/${businessId}/orders/${orderId}/status`;
  const [current, setCurrent] = useState<Status | null>(initial);
  const [statuses, setStatuses] = useState<Status[] | null>(null);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});

  function apply(json: Answer) {
    if (json.status) setCurrent({ key: json.status, label: json.statusLabel || json.status });
    if (json.statuses?.length) setStatuses(json.statuses);
  }
  async function load() {
    setBusy(true);
    setMessage({});
    try {
      const res = await fetch(url, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as Answer;
      if (!res.ok) throw new Error(json.error || t("Statusi nuk u lexua."));
      apply(json);
      setChoice(json.status ?? "");
      if (json.error) setMessage({ error: t(json.error) });
      else if (!json.statuses?.length) setMessage({ error: t("Webi i biznesit nuk dërgon ende listën e statuseve.") });
    } catch (e) {
      setMessage({ error: e instanceof Error ? e.message : t("Statusi nuk u lexua.") });
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!choice || choice === current?.key) return;
    setBusy(true);
    setMessage({});
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: choice }) });
      const json = (await res.json().catch(() => ({}))) as Answer;
      if (res.status === 202 || json.uncertain) return setMessage({ error: t(json.error || "Webi nuk u përgjigj. Rifresko statusin para se ta provosh sërish.") });
      if (!res.ok) throw new Error(json.error || t("Statusi nuk u ndryshua."));
      apply(json);
      setMessage({ success: t("Statusi u ndryshua në webin e biznesit.") });
      router.refresh();
    } catch (e) {
      setMessage({ error: e instanceof Error ? e.message : t("Statusi nuk u ndryshua.") });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-2">
      <p>
        <span className="muted-copy">{t("Statusi në web")}: </span>
        <strong>{current ? current.label : t("I panjohur")}</strong>
      </p>
      {statuses?.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <select className="field" value={choice} disabled={busy} onChange={(e) => setChoice(e.target.value)} aria-label={t("Statusi i ri")}>
            {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <button type="button" className="btn btn-primary" disabled={busy || !choice || choice === current?.key} onClick={() => void save()}>
            {busy ? t("Duke dërguar…") : t("Ruaj statusin")}
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void load()}>{t("Rifresko")}</button>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void load()}>
          {busy ? t("Duke lexuar…") : t("Ndrysho statusin")}
        </button>
      )}
      {message.error && <p className="smart-form-error" role="alert">{message.error}</p>}
      {message.success && <p className="muted-copy" role="status">{message.success}</p>}
    </div>
  );
}
