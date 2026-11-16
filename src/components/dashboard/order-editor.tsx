"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useDashboardTranslator } from "@/components/dashboard/language";

type Delivery = { name: string | null; phone: string | null; city: string | null; address: string | null };
type Change = { changeId: string; status: "pending" | "accepted" | "rejected" | "uncertain"; external: boolean;
  before: { customer: Record<string, string | null>; note: string | null };
  changes: { customer?: Record<string, string | null>; note?: string | null }; error: string | null; createdAt: string };
type View = { external: boolean; editable: boolean; websiteStatus: string | null; delivery: Delivery; note: string | null; changes: Change[] };

const labels: Record<string, string> = { name: "Emri", phone: "Telefoni", city: "Qyteti", address: "Adresa", note: "Shënimi" };
const statusLabels: Record<Change["status"], string> = { pending: "Në pritje", accepted: "U ndryshua", rejected: "U refuzua", uncertain: "E pakonfirmuar" };

/** "Ndrysho porosinë": the delivery details and the note of an existing order, with the history of changes. */
export function OrderEditor({ businessId, orderId }: { businessId: string; orderId: string }) {
  const t = useDashboardTranslator();
  const router = useRouter();
  const base = `/api/businesses/${businessId}/orders/${orderId}`;
  const [view, setView] = useState<View | null>(null);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({ name: "", phone: "", city: "", address: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  // One request per edit: sending again after an unclear answer reuses it, so the website applies it once.
  const [changeId, setChangeId] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setMessage({});
    try {
      const res = await fetch(base, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as View & { error?: string };
      if (!res.ok) throw new Error(json.error || t("Porosia nuk u lexua."));
      setView(json);
      setValues({ name: json.delivery.name ?? "", phone: json.delivery.phone ?? "", city: json.delivery.city ?? "", address: json.delivery.address ?? "", note: json.note ?? "" });
      const open = json.changes.find((c) => c.status === "uncertain" || c.status === "pending");
      setChangeId(open?.changeId ?? crypto.randomUUID());
      setOpen(true);
    } catch (e) {
      setMessage({ error: e instanceof Error ? e.message : t("Porosia nuk u lexua.") });
    } finally {
      setBusy(false);
    }
  }

  // Only what differs from the order is sent.
  function changes() {
    if (!view) return null;
    const customer: Record<string, string> = {};
    for (const key of ["name", "phone", "city", "address"] as const)
      if (values[key].trim() !== (view.delivery[key] ?? "")) customer[key] = values[key].trim();
    const out: { customer?: Record<string, string>; note?: string } = {};
    if (Object.keys(customer).length) out.customer = customer;
    if (values.note.trim() !== (view.note ?? "")) out.note = values.note.trim();
    return Object.keys(out).length ? out : null;
  }

  async function save(retry?: Change) {
    const body = retry ? { changeId: retry.changeId, changes: retry.changes } : { changeId, changes: changes() };
    if (!body.changes) return setMessage({ error: t("Nuk ka asnjë ndryshim nga të dhënat e porosisë.") });
    setBusy(true);
    setMessage({});
    try {
      const res = await fetch(base, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; change?: Change };
      if (json.ok) {
        setMessage({ success: view?.external ? t("Porosia u ndryshua edhe te webi i biznesit.") : t("Porosia u ndryshua.") });
        setChangeId(crypto.randomUUID());
        setOpen(false);
        router.refresh();
      } else {
        setMessage({ error: json.error || t("Ndryshimi nuk u ruajt. Provo përsëri.") });
        // A refused change is over; the next attempt is a new change.
        if (json.change?.status === "rejected") setChangeId(crypto.randomUUID());
      }
      const fresh = await fetch(base, { cache: "no-store" }).then((r) => (r.ok ? r.json() as Promise<View> : null)).catch(() => null);
      if (fresh) setView(fresh);
    } catch {
      setMessage({ error: t("Lidhja dështoi. Provo përsëri: ndryshimi nuk aplikohet dy herë.") });
    } finally {
      setBusy(false);
    }
  }

  const unclear = view?.changes.find((c) => c.status === "uncertain" || c.status === "pending");
  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues({ ...values, [key]: e.target.value });
  const describe = (c: Change) => [
    ...Object.entries(c.changes.customer ?? {}).map(([k, v]) => `${t(labels[k] ?? k)}: ${c.before.customer[k] || "—"} → ${v || "—"}`),
    ...(c.changes.note !== undefined ? [`${t("Shënimi")}: ${c.before.note || "—"} → ${c.changes.note || "—"}`] : []),
  ].join(" · ");

  return (
    <div className="mt-3">
      {!open ? (
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void load()}>{busy ? t("Duke lexuar…") : t("Ndrysho porosinë")}</button>
      ) : view && (
        <div className="conversation-form smart-form">
          {!view.editable ? (
            <p className="muted-copy">{t("Webi i biznesit nuk e lejon më ndryshimin e kësaj porosie")}{view.websiteStatus ? ` (${view.websiteStatus})` : ""}.</p>
          ) : unclear ? (
            <div className="grid gap-2">
              <p className="smart-form-error" role="alert">{t("Ndryshimi i fundit nuk u konfirmua nga webi:")} {describe(unclear)}</p>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save(unclear)}>{busy ? t("Duke dërguar…") : t("Provo përsëri")}</button>
            </div>
          ) : (
            <>
              <div className="smart-form-grid">
                {(["name", "phone", "city", "address"] as const).map((key) => (
                  <label key={key} className="grid gap-1">
                    <span className="muted-copy">{t(labels[key])}</span>
                    <input className="field" value={values[key]} onChange={set(key)} maxLength={key === "address" ? 300 : key === "phone" ? 40 : 120}
                      required={key === "name" || key === "phone"} type={key === "phone" ? "tel" : "text"} autoComplete="off" />
                  </label>
                ))}
              </div>
              <label className="grid gap-1">
                <span className="muted-copy">{t("Shënimi")}</span>
                <textarea className="field" rows={2} value={values.note} onChange={set("note")} maxLength={1000} />
              </label>
              {view.external && <p className="muted-copy">{t("Ndryshimi dërgohet te webi i biznesit dhe ruhet vetëm kur webi e pranon.")}</p>}
              <div className="flex gap-2">
                <button type="button" className="btn btn-primary" disabled={busy || !changes()} onClick={() => void save()}>{busy ? t("Duke ruajtur…") : t("Ruaj ndryshimin")}</button>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setOpen(false); setMessage({}); }}>{t("Anulo")}</button>
              </div>
            </>
          )}
          {view.changes.length > 0 && (
            <div className="grid gap-1">
              <h4 className="muted-copy">{t("Ndryshimet")}</h4>
              {view.changes.map((c) => (
                <p key={c.changeId} className="muted-copy text-xs">
                  {new Date(c.createdAt).toLocaleString("sq-AL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Tirane" })}
                  {" · "}{t(statusLabels[c.status])}{" · "}{describe(c)}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
      {message.error && <p role="alert" className="smart-form-error">{message.error}</p>}
      {message.success && <p role="status" className="smart-form-success">{message.success}</p>}
    </div>
  );
}
