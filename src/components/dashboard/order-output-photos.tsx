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
  const thumbs = (list: File[], item?: number) => (
    <div className="order-chat-photos">
      {list.map((f) => (
        <span key={f.url}>
          <a href={f.url} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element -- the business website's own image */}
            <img src={f.url} alt="" loading="lazy" />
          </a>
          {item !== undefined && (
            <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => void sendToCustomer(item, f)}>
              {busy === `send|${f.url}` ? t("Duke dërguar…") : t("Dërgoja klientit")}
            </button>
          )}
        </span>
      ))}
    </div>
  );

  return (
    <div className="detail-block">
      <h3>{t("Fotot e artikujve")}</h3>
      {view.items.map((item) => {
        const own = item.files ?? [];
        const customer = own.filter((f) => f.role === "input");
        return (
          <div key={item.item} className="detail-fields">
            {view.items.length > 1 && <p><strong>{t("Artikulli")} {item.item}: {item.productName}</strong></p>}
            {customer.length > 0 && <><p className="muted-copy">{t("Fotot e klientit")}</p>{thumbs(customer)}</>}
            {item.outputFields.map((field) => {
              const mark = `${item.item}|${field.key}`;
              const list = own.filter((f) => f.role === "output" && f.key === field.key);
              return (
                <div key={field.key}>
                  <p className="muted-copy">{field.label}</p>
                  {list.length ? thumbs(list, item.item) : <p className="muted-copy">{t("Ende pa foto.")}</p>}
                  <label className="btn btn-ghost">
                    {busy === mark ? t("Duke ngarkuar…") : t("Ngarko foto")}
                    <input type="file" hidden accept="image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={busy !== null}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) void add(item.item, field.key, upload(file));
                      }} />
                  </label>
                  <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => pick(mark)}>{t("Zgjidh nga biseda")}</button>
                  {picking === mark && (
                    chat === null ? <p className="muted-copy">{t("Duke lexuar fotot e bisedës…")}</p>
                      : chat.length === 0 ? <p className="muted-copy">{t("Nuk ka foto në bisedë.")}</p>
                      : (
                        <div className="order-chat-photos">
                          {chat.map((photo) => (
                            <button key={photo.id} type="button" disabled={busy !== null} title={photo.byBusiness ? t("E dërguar nga biznesi") : t("E dërguar nga klienti")}
                              onClick={() => void add(item.item, field.key, copy(photo.id))}>
                              {/* eslint-disable-next-line @next/next/no-img-element -- private, same-origin preview behind the member check */}
                              <img src={`${files}?photo=${encodeURIComponent(photo.id)}`} alt={photo.caption || t("Foto nga biseda")} loading="lazy" />
                            </button>
                          ))}
                        </div>
                      )
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      {notice && <p role="status" className="muted-copy">{notice}</p>}
      {error && <p role="alert" className="text-danger">{error}</p>}
    </div>
  );
}
