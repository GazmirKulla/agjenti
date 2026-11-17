"use client";
import { useCallback, useEffect, useState } from "react";
import { useDashboardTranslator } from "@/components/dashboard/language";

type File = { key: string; role: "input" | "output"; url: string };
type Item = { item: number; productName: string; outputFields: { key: string; label: string; max?: number }[]; files?: File[] };
type View = { sent: boolean; conversationId: string | null; items: Item[]; error?: string };
type ChatPhoto = { id: string; createdAt: string; caption: string | null; byBusiness?: boolean };

/**
 * The item photos of an order on the business website, read from the website (it keeps them): the
 * customer's, and the store's own (processed design shown to the customer, finished product). The store's
 * photos can be added from the device or from the conversation, also after the order exists.
 */
export function OrderOutputPhotos({ businessId, orderId }: { businessId: string; orderId: string }) {
  const t = useDashboardTranslator();
  const base = `/api/businesses/${businessId}/orders/${orderId}/files`;
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatPhoto[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(() => {
    fetch(base, { cache: "no-store" })
      .then((res) => res.json().then((json: View & { error?: string }) => (res.ok ? json : Promise.reject(new Error(json.error)))))
      .then((json) => { setView(json); setError(json.error ?? null); }, (err: unknown) => setError(err instanceof Error && err.message ? err.message : t("Fotot nuk u lexuan.")));
  }, [base, t]);
  useEffect(load, [load]);
  if (!view && !error) return <p className="muted-copy">{t("Duke lexuar fotot e artikujve…")}</p>;
  if (!view?.sent || !view.items.some((i) => i.outputFields.length || i.files?.length)) return error ? <p className="text-danger">{error}</p> : null;
  const files = `/api/businesses/${businessId}/conversations/${view.conversationId}/order-files`;

  async function add(item: number, key: string, toPath: () => Promise<string>) {
    const mark = `${item}|${key}`;
    setBusy(mark);
    setError(null);
    try {
      const path = await toPath();
      const res = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item, key, paths: [path] }) });
      const json = (await res.json().catch(() => ({}))) as View & { error?: string };
      if (!res.ok) throw new Error(json.error || t("Fotoja nuk u shtua."));
      setView(json);
      setPicking(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Fotoja nuk u shtua."));
    } finally {
      setBusy(null);
    }
  }
  const stored = async (res: Response) => {
    const json = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
    if (!res.ok || !json.path) throw new Error(json.error || t("Fotoja nuk u ngarkua."));
    return json.path;
  };
  const upload = (file: globalThis.File) => async () => {
    const body = new FormData();
    body.append("file", file);
    return stored(await fetch(files, { method: "POST", body }));
  };
  const copy = (photoId: string) => async () =>
    stored(await fetch(files, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ photoId }) }));
  const pick = (mark: string) => {
    setPicking(picking === mark ? null : mark);
    if (chat === null)
      fetch(`${files}?from=all`, { cache: "no-store" }).then((res) => (res.ok ? res.json() : null))
        .then((json: { photos?: ChatPhoto[] } | null) => setChat(json?.photos ?? []), () => setChat([]));
  };
  /** Sends one of the store's photos to the customer in the conversation, for approval. */
  async function sendToCustomer(item: number, file: File) {
    const caption = window.prompt(t("Shënim për klientin (opsional):"), t("Ja si do dalë. A ju pëlqen?"));
    if (caption === null) return;
    setBusy(`send|${file.url}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/businesses/${businessId}/conversations/${view!.conversationId}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), body: caption.trim(), media: { orderId, item, key: file.key, url: file.url } }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || t("Fotoja nuk u dërgua."));
      setNotice(t("Fotoja po i dërgohet klientit. Statusin e sheh te biseda."));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Fotoja nuk u dërgua."));
    } finally {
      setBusy(null);
    }
  }
  /** A grid of square photos; the store's own carry "Dërgoja klientit" under each. */
  const grid = (list: File[], item?: number) => (
    <ul className="order-photos-grid">
      {list.map((f) => (
        <li key={f.url} className="order-photo">
          <a href={f.url} target="_blank" rel="noreferrer" className="order-photo-image" aria-label={t("Hap foton")}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the business website's own image */}
            <img src={f.url} alt="" loading="lazy" />
          </a>
          {item !== undefined && (
            <button type="button" className="order-photo-action" disabled={busy !== null} onClick={() => void sendToCustomer(item, f)}>
              {busy === `send|${f.url}` ? t("Duke dërguar…") : t("Dërgoja klientit")}
            </button>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="detail-block order-photos">
      <h3>{t("Fotot e artikujve")}</h3>
      {view.items.map((item) => {
        const own = item.files ?? [];
        const customer = own.filter((f) => f.role === "input");
        return (
          <section key={item.item} className="order-photos-item">
            {view.items.length > 1 && (
              <p className="order-photos-item-title">
                <span>{t("Artikulli")} {item.item}</span> {item.productName}
              </p>
            )}
            {customer.length > 0 && (
              <div className="order-photos-group">
                <div className="order-photos-group-head">
                  <h4>{t("Fotot e klientit")}</h4>
                  <span className="order-photos-count">{customer.length}</span>
                </div>
                {grid(customer)}
              </div>
            )}
            {item.outputFields.map((field) => {
              const mark = `${item.item}|${field.key}`;
              const list = own.filter((f) => f.role === "output" && f.key === field.key);
              return (
                <div key={field.key} className="order-photos-group">
                  <div className="order-photos-group-head">
                    <h4>{field.label}</h4>
                    {list.length > 0 && <span className="order-photos-count">{list.length}</span>}
                    <div className="order-photos-actions">
                      <label className={`btn btn-ghost btn-small${busy !== null ? " is-disabled" : ""}`}>
                        {busy === mark ? t("Duke ngarkuar…") : t("Ngarko foto")}
                        <input type="file" hidden accept="image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={busy !== null}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) void add(item.item, field.key, upload(file));
                          }} />
                      </label>
                      <button type="button" className={`btn btn-ghost btn-small${picking === mark ? " is-active" : ""}`} disabled={busy !== null}
                        aria-expanded={picking === mark} onClick={() => pick(mark)}>
                        {t("Zgjidh nga biseda")}
                      </button>
                    </div>
                  </div>
                  {list.length ? grid(list, item.item) : <p className="order-photos-empty">{t("Ende pa foto.")}</p>}
                  {picking === mark && (
                    <div className="order-photos-picker">
                      <p className="muted-copy">{t("Kliko një foto të bisedës për ta shtuar këtu.")}</p>
                      {chat === null ? <p className="muted-copy">{t("Duke lexuar fotot e bisedës…")}</p>
                        : chat.length === 0 ? <p className="muted-copy">{t("Nuk ka foto në bisedë.")}</p>
                        : (
                          <ul className="order-photos-grid">
                            {chat.map((photo) => (
                              <li key={photo.id} className="order-photo">
                                <button type="button" className="order-photo-image" disabled={busy !== null}
                                  title={photo.byBusiness ? t("E dërguar nga biznesi") : t("E dërguar nga klienti")}
                                  onClick={() => void add(item.item, field.key, copy(photo.id))}>
                                  {/* eslint-disable-next-line @next/next/no-img-element -- private, same-origin preview behind the member check */}
                                  <img src={`${files}?photo=${encodeURIComponent(photo.id)}`} alt={photo.caption || t("Foto nga biseda")} loading="lazy" />
                                </button>
                                <span className="order-photo-caption">{photo.byBusiness ? t("Biznesi") : t("Klienti")}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
      {notice && <p role="status" className="smart-form-success">{notice}</p>}
      {error && <p role="alert" className="smart-form-error">{error}</p>}
    </div>
  );
}
