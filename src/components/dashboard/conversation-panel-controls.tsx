"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDashboardTranslator } from "@/components/dashboard/language";
import type { LeadStatus } from "@/lib/leads/model";

async function post(url: string, body: object) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error || "Veprimi dështoi.");
}

type PrefillField = { value: string; source: "agjenti" | "biseda"; evidence: string };
type PrefillData = { fields: Partial<Record<string, PrefillField>>; productName: string | null; missing: string[]; workflowFields: string[]; scanned: number };

/** Reads the conversation for a form (read-only) once it opens; `reload` reads it again. */
function usePrefill(base: string, form: "order" | "booking" | "customer", active: boolean) {
  const [state, setState] = useState<{ loading: boolean; data: PrefillData | null; error: string | null }>({ loading: false, data: null, error: null });
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, error: null }));
    fetch(`${base}/prefill?form=${form}`, { signal: controller.signal })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as PrefillData & { error?: string };
        if (!res.ok) throw new Error(json.error || "Biseda nuk u lexua.");
        setState({ loading: false, data: json, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ loading: false, data: null, error: error instanceof Error ? error.message : "Biseda nuk u lexua." });
      });
    return () => controller.abort();
  }, [base, form, active, round]);
  return { ...state, reload: () => setRound((value) => value + 1) };
}

/** "Po lexoj bisedën…", what was filled and what is still missing. */
function PrefillStatus({ prefill }: { prefill: ReturnType<typeof usePrefill> }) {
  const t = useDashboardTranslator();
  const filled = prefill.data ? Object.keys(prefill.data.fields).length : 0;
  return (
    <div className={`smart-form-status${prefill.loading ? " is-loading" : ""}`} role="status" aria-live="polite">
      <span className="smart-form-status-icon" aria-hidden>✦</span>
      <div className="smart-form-status-copy">
        {prefill.loading ? (
          <strong>{t("Po lexoj bisedën…")}</strong>
        ) : prefill.error ? (
          <><strong>{t("Biseda nuk u lexua")}</strong><span>{t("Plotëso formën vetë ose provo përsëri.")}</span></>
        ) : prefill.data ? (
          <>
            <strong>{filled ? t("U plotësua nga biseda") : t("Biseda nuk kishte të dhëna për këtë formë")}</strong>
            {prefill.data.missing.length > 0 && <span>{t("Mungon")}: {prefill.data.missing.map((label) => t(label)).join(", ")}</span>}
            {filled > 0 && prefill.data.missing.length === 0 && <span>{t("Kontrolloji të dhënat dhe ruaje.")}</span>}
          </>
        ) : null}
      </div>
      {!prefill.loading && (
        <button type="button" className="btn btn-ghost smart-form-reload" onClick={prefill.reload}>
          {prefill.data || prefill.error ? t("Lexo përsëri") : t("Plotëso nga biseda")}
        </button>
      )}
    </div>
  );
}

/** A form label with a "Nga biseda" mark (and its quote) when the value came from the conversation. */
function SmartLabel({ label, field, children, wide }: { label: string; field?: PrefillField; children: React.ReactNode; wide?: boolean }) {
  const t = useDashboardTranslator();
  return (
    <label className={wide ? "smart-field is-wide" : "smart-field"}>
      <span className="smart-field-label">
        {t(label)}
        {field && (
          <span className="smart-field-badge" title={field.evidence ? `«${field.evidence}»` : undefined}>
            {field.source === "agjenti" ? t("Nga agjenti") : t("Nga biseda")}
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

/** Puts each reading into the form, except in fields the owner already changed. */
function useApplyPrefill<T extends Record<string, string>>(data: PrefillData | null, map: Partial<Record<keyof T, string>>, setValues: React.Dispatch<React.SetStateAction<T>>, initial: T) {
  const last = useRef(initial);
  useEffect(() => {
    if (!data) return;
    setValues((current) => {
      const next = { ...current };
      for (const [key, source] of Object.entries(map) as [keyof T, string][]) {
        const found = data.fields[source]?.value;
        const untouched = !String(current[key] ?? "").trim() || current[key] === last.current[key];
        if (found && untouched) next[key] = found as T[keyof T];
      }
      last.current = next;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applies once per reading
  }, [data]);
}

/** Creates the CRM customer from the details the agent collected; the owner can correct them first. */
export function SaveCustomerForm(props: { businessId: string; conversationId: string; name: string; phone: string }) {
  const t = useDashboardTranslator();
  const router = useRouter();
  const base = `/api/businesses/${props.businessId}/conversations/${props.conversationId}`;
  const [initial] = useState({ name: props.name, phone: props.phone });
  const [values, setValues] = useState(initial);
  const [asked, setAsked] = useState(false);
  const prefill = usePrefill(base, "customer", asked);
  useApplyPrefill(prefill.data, { name: "name", phone: "phone" }, setValues, initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields = prefill.data?.fields ?? {};
  return (
    <form
      className="conversation-form smart-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending) return;
        setPending(true);
        setError(null);
        try {
          await post(`${base}/customer`, { name: values.name.trim(), phone: values.phone.trim() });
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Shtimi i klientit dështoi.");
        } finally {
          setPending(false);
        }
      }}
    >
      {asked ? (
        <PrefillStatus prefill={prefill} />
      ) : (
        <button type="button" className="smart-form-start" onClick={() => setAsked(true)}>
          <span aria-hidden>✦</span> {t("Plotëso nga biseda")}
        </button>
      )}
      <div className="smart-form-grid">
        <SmartLabel label="Emri" field={fields.name}>
          <input className="field" value={values.name} maxLength={120} autoComplete="off" placeholder={t("Emri dhe mbiemri")} onChange={(e) => setValues({ ...values, name: e.target.value })} />
        </SmartLabel>
        <SmartLabel label="Telefoni" field={fields.phone}>
          <input className="field" type="tel" value={values.phone} maxLength={40} autoComplete="off" placeholder="+355…" onChange={(e) => setValues({ ...values, phone: e.target.value })} />
        </SmartLabel>
      </div>
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? t("Duke ruajtur…") : t("Ruaj si klient")}
      </button>
      {error && <p role="alert" className="smart-form-error">{t(error)}</p>}
    </form>
  );
}

const leadOptions: { value: LeadStatus; label: string }[] = [
  { value: "new", label: "I ri" },
  { value: "contacted", label: "Në kontakt" },
  { value: "won", label: "U bë klient" },
  { value: "lost", label: "Humbur" },
];

export function LeadStatusControl(props: { businessId: string; conversationId: string; leadId: string; status: LeadStatus }) {
  const t = useDashboardTranslator();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="conversation-form">
      <label>
        {t("Statusi i kontaktit")}
        <select
          className="field"
          value={props.status}
          disabled={pending}
          onChange={async (event) => {
            setPending(true);
            setError(null);
            try {
              await post(`/api/businesses/${props.businessId}/conversations/${props.conversationId}/lead`, { leadId: props.leadId, status: event.target.value });
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Statusi nuk u ndryshua. Provo përsëri.");
            } finally {
              setPending(false);
            }
          }}
        >
          {leadOptions.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
        </select>
      </label>
      {error && <p role="alert" className="muted-copy text-red-600">{t(error)}</p>}
    </div>
  );
}

export function CopyInvitationLink({ url }: { url: string }) {
  const t = useDashboardTranslator();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost w-full mt-3"
      onClick={() => {
        void navigator.clipboard?.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? t("Linku u kopjua") : t("Kopjo linkun e ftesës")}
    </button>
  );
}

type DeclaredValue = { id: string; name: string };
type DeclaredField = { key: string; label: string; type: "text" | "number" | "boolean" | "date" | "choice" | "photo" | "file"; required: boolean; min?: number; max?: number; maxLength?: number; values?: DeclaredValue[] };
/** What the business website declares for a linked product: choices beyond the variant, extras and the data the order needs. */
type Declared = {
  options: { key: string; label: string; required: boolean; values: DeclaredValue[] }[];
  addons: { id: string; name: string; price: number; appliesToVariants?: string[] }[];
  fields: DeclaredField[];
};
type ProductOption = {
  id: string; name: string; price: number | null; currency: string | null; unit?: string | null;
  variants?: { id: string; label: string; price: number; externalId?: string | null }[];
  declared?: Declared; sendsToWebsite?: boolean;
};
type Selection = { options: Record<string, string>; fields: Record<string, string | number | boolean>; files: Record<string, string[]>; addons: string[] };
const emptySelection = (): Selection => ({ options: {}, fields: {}, files: {}, addons: [] });
type Submission = { status: "local_only" | "pending_reconciliation" | "accepted" | "rejected"; externalOrderId?: string | null; reason?: string;
  /** The field the website refused, its label and the item (1-based), when the website named one. */
  field?: string; fieldLabel?: string; line?: number;
  /** What the website charges (items plus shipping) and its shipping, when it says so. */
  websiteTotal?: number; shipping?: number; currency?: string };

/** Uploads one reference photo to the conversation and returns its private path. */
async function uploadOrderFile(base: string, file: File): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`${base}/order-files`, { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
  if (!res.ok || !json.path) throw new Error(json.error || "Fotoja nuk u ngarkua.");
  return json.path;
}

type ChatPhoto = { id: string; createdAt: string; caption: string | null };

/** Photos the customer sent in the conversation, read once while a photo field is shown. */
function useChatPhotos(base: string, active: boolean): ChatPhoto[] | null {
  const [photos, setPhotos] = useState<ChatPhoto[] | null>(null);
  useEffect(() => {
    if (!active) return;
    let current = true;
    fetch(`${base}/order-files`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { photos?: ChatPhoto[] } | null) => current && setPhotos(Array.isArray(json?.photos) ? json.photos : []), () => current && setPhotos([]));
    return () => {
      current = false;
    };
  }, [base, active]);
  return photos;
}

/** Copies a conversation photo into the order's private files, so the website gets a lasting link. */
async function copyChatPhoto(base: string, photoId: string): Promise<string> {
  const res = await fetch(`${base}/order-files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ photoId }) });
  const json = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
  if (!res.ok || !json.path) throw new Error(json.error || "Fotoja nuk u ngarkua.");
  return json.path;
}

/** The choices, extras and fields a linked product needs, built from the website's declaration. */
function DeclaredInputs(props: {
  base: string; declared: Declared; variantExternalId: string | null; currency: string | null;
  selection: Selection; onChange: (next: Selection) => void;
}) {
  const t = useDashboardTranslator();
  const { declared, selection, onChange } = props;
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Which conversation photo became which stored file, per field: `${field}|${photoId}` → path.
  const [fromChat, setFromChat] = useState<Record<string, string>>({});
  const chatPhotos = useChatPhotos(props.base, declared.fields.some((f) => f.type === "photo" || f.type === "file"));
  // Uploads finish after other choices may have changed: always build on the latest selection.
  const latest = useRef(selection);
  useEffect(() => {
    latest.current = selection;
  });
  const addFiles = (key: string, added: string[]) => {
    const current = latest.current;
    onChange({ ...current, files: { ...current.files, [key]: [...(current.files[key] ?? []), ...added] } });
  };
  const toggleChatPhoto = async (key: string, photoId: string, max: number) => {
    const mark = `${key}|${photoId}`;
    const stored = fromChat[mark];
    if (stored) {
      const current = latest.current;
      onChange({ ...current, files: { ...current.files, [key]: (current.files[key] ?? []).filter((path) => path !== stored) } });
      setFromChat((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== mark)));
      return;
    }
    if ((latest.current.files[key] ?? []).length >= max) return;
    setUploading(key);
    setUploadError(null);
    try {
      const path = await copyChatPhoto(props.base, photoId);
      addFiles(key, [path]);
      setFromChat((current) => ({ ...current, [mark]: path }));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t("Fotoja nuk u ngarkua."));
    } finally {
      setUploading(null);
    }
  };
  const addons = declared.addons.filter((a) => !a.appliesToVariants || (props.variantExternalId && a.appliesToVariants.includes(props.variantExternalId)));
  if (!declared.options.length && !addons.length && !declared.fields.length) return null;
  const setField = (key: string, value: string | number | boolean | null) => {
    const fields = { ...selection.fields };
    if (value === null || value === "") delete fields[key];
    else fields[key] = value;
    onChange({ ...selection, fields });
  };
  return (
    <>
      {declared.options.map((o) => (
        <SmartLabel key={o.key} label={o.label}>
          <select className="field" value={selection.options[o.key] ?? ""} required={o.required}
            onChange={(e) => {
              const options = { ...selection.options };
              if (e.target.value) options[o.key] = e.target.value;
              else delete options[o.key];
              onChange({ ...selection, options });
            }}>
            <option value="">{t("Zgjidh")}</option>
            {o.values.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </SmartLabel>
      ))}
      {addons.map((a) => (
        <label key={a.id} className="smart-form-check">
          <input type="checkbox" checked={selection.addons.includes(a.id)}
            onChange={(e) => onChange({ ...selection, addons: e.target.checked ? [...selection.addons, a.id] : selection.addons.filter((id) => id !== a.id) })} />
          {a.name} · +{a.price} {props.currency ?? ""}
        </label>
      ))}
      {declared.fields.map((f) => {
        if (f.type === "photo" || f.type === "file") {
          const paths = selection.files[f.key] ?? [];
          const max = Math.min(f.max ?? 5, 10);
          return (
            <SmartLabel key={f.key} label={`${f.label}${f.required ? " *" : ""}`} wide>
              <input className="field" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple
                disabled={uploading === f.key || paths.length >= max}
                onChange={async (e) => {
                  const chosen = Array.from(e.target.files ?? []).slice(0, max - paths.length);
                  e.target.value = "";
                  if (!chosen.length) return;
                  setUploading(f.key);
                  setUploadError(null);
                  try {
                    const added: string[] = [];
                    for (const file of chosen) added.push(await uploadOrderFile(props.base, file));
                    addFiles(f.key, added);
                  } catch (err) {
                    setUploadError(err instanceof Error ? err.message : t("Fotoja nuk u ngarkua."));
                  } finally {
                    setUploading(null);
                  }
                }} />
              <span className="muted-copy">
                {uploading === f.key ? t("Duke ngarkuar…") : `${paths.length}/${max} ${t("foto")}`}
                {paths.length > 0 && (
                  <button type="button" className="btn btn-ghost" onClick={() => {
                    onChange({ ...selection, files: { ...selection.files, [f.key]: [] } });
                    setFromChat((current) => Object.fromEntries(Object.entries(current).filter(([mark]) => !mark.startsWith(`${f.key}|`))));
                  }}>{t("Hiq fotot")}</button>
                )}
              </span>
              {chatPhotos?.length ? (
                <>
                  <span className="muted-copy">{t("Ose zgjidh nga fotot që dërgoi klienti në bisedë:")}</span>
                  <div className="order-chat-photos">
                    {chatPhotos.map((photo) => {
                      const chosen = Boolean(fromChat[`${f.key}|${photo.id}`]);
                      return (
                        <button key={photo.id} type="button" aria-pressed={chosen} title={photo.caption ?? new Date(photo.createdAt).toLocaleString()}
                          disabled={uploading !== null || (!chosen && paths.length >= max)}
                          onClick={() => void toggleChatPhoto(f.key, photo.id, max)}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- private, same-origin preview behind the member check */}
                          <img src={`${props.base}/order-files?photo=${encodeURIComponent(photo.id)}`} alt={photo.caption || t("Foto nga biseda")} loading="lazy" />
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}
              {uploadError && <span role="alert" className="text-danger">{uploadError}</span>}
            </SmartLabel>
          );
        }
        const value = selection.fields[f.key];
        if (f.type === "boolean")
          return (
            <label key={f.key} className="smart-form-check">
              <input type="checkbox" checked={value === true} onChange={(e) => setField(f.key, e.target.checked ? true : null)} />
              {f.label}
            </label>
          );
        if (f.type === "choice")
          return (
            <SmartLabel key={f.key} label={f.label}>
              <select className="field" value={typeof value === "string" ? value : ""} required={f.required} onChange={(e) => setField(f.key, e.target.value)}>
                <option value="">{t("Zgjidh")}</option>
                {(f.values ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </SmartLabel>
          );
        return (
          <SmartLabel key={f.key} label={f.label} wide={f.type === "text"}>
            <input className="field" type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} required={f.required}
              maxLength={f.type === "text" ? f.maxLength ?? 500 : undefined} min={f.type === "number" ? f.min : undefined} max={f.type === "number" ? f.max : undefined}
              value={value === undefined ? "" : String(value)}
              onChange={(e) => setField(f.key, f.type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)} />
          </SmartLabel>
        );
      })}
    </>
  );
}

/** " Totali te webi: 2900 ALL (me transportin 200)." when the website gave its total. */
function websiteTotal(submission: Submission, t: (text: string) => string): string {
  if (submission.websiteTotal === undefined) return "";
  const currency = submission.currency ? ` ${submission.currency}` : "";
  const shipping = submission.shipping ? ` (${t("me transportin")} ${submission.shipping})` : "";
  return ` ${t("Totali te webi")}: ${submission.websiteTotal}${currency}${shipping}.`;
}

/** "Artikulli 2: mungon «Personazhi»." from the field the website named; empty when it named none. */
function refusedField(submission: Submission, t: (text: string) => string): string {
  if (!submission.field) return "";
  const label = submission.fieldLabel ?? submission.field;
  const missing = submission.reason?.startsWith("missing_");
  if (!submission.line) return ` ${missing ? t("Mungon") : t("Nuk pranohet")} «${label}».`;
  return ` ${t("Artikulli")} ${submission.line}: ${missing ? t("mungon") : t("nuk pranohet")} «${label}».`;
}

/** The result line after saving: local, sent to the website, refused or to be checked. */
function submissionMessage(submission: Submission | undefined, t: (text: string) => string): string {
  if (!submission || submission.status === "local_only")
    return submission?.reason
      ? t("Porosia u ruajt vetëm këtu: produkti nuk është i lidhur ose i rifreskuar nga webi, ndaj nuk u dërgua.")
      : t("Porosia u ruajt.");
  if (submission.status === "accepted")
    return `${t("Porosia u ruajt dhe u krijua te webi i biznesit.")}${submission.externalOrderId ? ` #${submission.externalOrderId}` : ""}${websiteTotal(submission, t)}`;
  if (submission.status === "rejected")
    return `${t("Porosia u ruajt, por webi i biznesit e refuzoi.")}${submission.reason === "price_changed" ? ` ${t("Çmimi ka ndryshuar: rifresko produktet nga webi.")}` : refusedField(submission, t) || (submission.reason ? ` (${submission.reason})` : "")}`;
  return t("Porosia u ruajt, por dërgimi te webi nuk u verifikua. Kontrollo te Porositë; mos e ridërgo.");
}

/** Opens the form when the menu links to it (#krijo-porosi, #cakto-takim). */
function useHashOpen(id: string) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const sync = () => {
      if (window.location.hash === `#${id}`) setOpen(true);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [id]);
  return [open, setOpen] as const;
}

/** One item of the order being written: its own product, variant, choices and quantity. */
type OrderLine = {
  key: string; productId: string; chosenName: string | null; variantId: string; quantity: string;
  selection: Selection; product: ProductOption | null;
};
const MAX_ORDER_LINES = 10;
const newLine = (productId = "", quantity = "", chosenName: string | null = null): OrderLine => ({
  key: crypto.randomUUID(), productId, chosenName, variantId: "", quantity, selection: emptySelection(), product: null,
});

/** Unit price with extras × quantity, as the server computes it; null while it is not known. */
function linePrice(line: OrderLine): { total: number | null; currency: string | null } {
  const product = line.product;
  const variant = product?.variants?.find((v) => v.id === line.variantId);
  const base = variant ? variant.price : product?.variants?.length ? null : product?.price ?? null;
  const extras = (product?.declared?.addons ?? []).filter((a) => line.selection.addons.includes(a.id)).reduce((sum, a) => sum + a.price, 0);
  const quantity = Number(line.quantity) || 1;
  return { total: base != null ? Math.round((base + extras) * quantity * 100) / 100 : null, currency: product?.currency ?? null };
}

/** The body of one item for the order request. */
function lineBody(line: OrderLine) {
  const variant = line.product?.variants?.find((v) => v.id === line.variantId);
  return {
    productId: line.productId,
    ...(variant ? { variantId: variant.id } : {}),
    ...(line.product?.declared ? { selection: line.selection } : {}),
    quantity: Number(line.quantity) || 1,
  };
}

/** Search, product, variant, declared choices and quantity of one order item. */
function OrderLineEditor(props: {
  base: string; open: boolean; index: number; count: number; line: OrderLine; fields: PrefillData["fields"];
  onChange: (update: (line: OrderLine) => OrderLine) => void; onRemove?: () => void;
}) {
  const t = useDashboardTranslator();
  const { base, line, onChange } = props;
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<ProductOption[]>([]);
  useEffect(() => {
    if (!props.open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`${base}/products?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((res) => res.json())
        .then((json: { products?: ProductOption[] }) => setProducts(json.products ?? []))
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [props.open, query, base]);
  // A product chosen before the list loaded (prefill from the conversation) gets its details once it appears.
  const listed = products.find((p) => p.id === line.productId);
  useEffect(() => {
    if (listed && line.product?.id !== listed.id) onChange((current) => (current.productId === listed.id ? { ...current, product: listed } : current));
  }, [listed, line.product, onChange]);
  const selected = line.product?.id === line.productId ? line.product : listed;
  const variant = selected?.variants?.find((v) => v.id === line.variantId);
  const measure = selected?.unit ?? null;
  const { total } = linePrice({ ...line, product: selected ?? null });
  const first = props.index === 0;
  return (
    <fieldset className="smart-form-group">
      <legend>{props.count > 1 ? `${t("Artikulli")} ${props.index + 1}` : t("Çfarë porositet")}</legend>
      <SmartLabel label="Produkti" field={first ? props.fields.product_id : undefined} wide>
        <input className="field" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Kërko produktin")} aria-label={t("Kërko produktin")} />
        <select className="field" value={line.productId} required
          onChange={(e) => {
            const product = products.find((p) => p.id === e.target.value) ?? null;
            onChange((current) => ({ ...current, productId: e.target.value, chosenName: product?.name ?? null, product, variantId: "", selection: emptySelection() }));
          }}>
          <option value="">{t("Zgjidh produktin")}</option>
          {line.productId && !listed && <option value={line.productId}>{line.chosenName ?? selected?.name ?? t("Produkti i zgjedhur nga biseda")}</option>}
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}{p.price != null ? ` · ${p.price} ${p.currency ?? ""}${p.unit ? `/${p.unit}` : ""}` : ""}</option>
          ))}
        </select>
      </SmartLabel>
      {selected?.variants?.length ? (
        <SmartLabel label="Varianti">
          <select className="field" value={line.variantId} required
            onChange={(e) => {
              const variantId = e.target.value;
              onChange((current) => ({ ...current, variantId, selection: { ...current.selection, addons: [] } }));
            }}>
            <option value="">{t("Zgjidh variantin")}</option>
            {selected.variants.map((v) => <option key={v.id} value={v.id}>{v.label} · {v.price} {selected.currency ?? ""}</option>)}
          </select>
        </SmartLabel>
      ) : null}
      {selected?.declared && (
        <DeclaredInputs base={base} declared={selected.declared} variantExternalId={variant?.externalId ?? null}
          currency={selected.currency} selection={line.selection} onChange={(selection) => onChange((current) => ({ ...current, selection }))} />
      )}
      <SmartLabel label={measure ? `${t("Sasia")} (${measure})` : "Sasia"} field={first ? props.fields.quantity : undefined}>
        <input className="field" type="number" inputMode={measure ? "decimal" : "numeric"} min={measure ? 0.001 : 1} max={measure ? 100000 : 999} step={measure ? 0.001 : 1}
          value={line.quantity} placeholder="1" onChange={(e) => {
            const quantity = e.target.value;
            onChange((current) => ({ ...current, quantity }));
          }} />
      </SmartLabel>
      {total != null && props.count > 1 && <p className="muted-copy">{t("Shuma e artikullit")}: {total} {selected?.currency}</p>}
      {props.onRemove && (
        <button type="button" className="btn btn-ghost" onClick={props.onRemove}>{t("Hiq artikullin")}</button>
      )}
    </fieldset>
  );
}

/** A LOCAL order from this conversation, with one or more items; the server takes the prices from the catalog. */
export function ManualOrderForm(props: {
  businessId: string;
  conversationId: string;
  productId: string | null;
  productName: string | null;
  quantity: number;
  customer: { name: string; phone: string; city: string; address: string };
}) {
  const t = useDashboardTranslator();
  const router = useRouter();
  const base = `/api/businesses/${props.businessId}/conversations/${props.conversationId}`;
  const [open, setOpen] = useHashOpen("krijo-porosi");
  const prefill = usePrefill(base, "order", open);
  const [initial] = useState({
    name: props.customer.name,
    phone: props.customer.phone,
    city: props.customer.city,
    address: props.customer.address,
    note: "",
  });
  const [values, setValues] = useState(initial);
  const [lines, setLines] = useState<OrderLine[]>(() => [newLine(props.productId ?? "", props.productId ? String(props.quantity) : "", props.productName)]);
  useApplyPrefill(prefill.data, { name: "name", phone: "phone", city: "city", address: "address", note: "note" }, setValues, initial);
  // The conversation's product and quantity fill the first item, unless the owner already changed it.
  const [firstInitial] = useState({ productId: props.productId ?? "", quantity: props.productId ? String(props.quantity) : "" });
  const setFirstLine = useCallback<React.Dispatch<React.SetStateAction<typeof firstInitial>>>((update) => {
    setLines((current) => {
      const [first, ...rest] = current;
      const before = { productId: first.productId, quantity: first.quantity };
      const next = typeof update === "function" ? update(before) : update;
      if (next.productId === before.productId && next.quantity === before.quantity) return current;
      const changed = next.productId !== before.productId;
      return [{ ...first, ...next, ...(changed ? { variantId: "", selection: emptySelection(), product: null, chosenName: null } : {}) }, ...rest];
    });
  }, []);
  useApplyPrefill(prefill.data, { productId: "product_id", quantity: "quantity" }, setFirstLine, firstInitial);
  useEffect(() => {
    const name = prefill.data?.productName;
    if (name) setLines((current) => [{ ...current[0], chosenName: current[0].chosenName ?? name }, ...current.slice(1)]);
  }, [prefill.data]);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  const updateLine = useCallback((key: string) => (update: (line: OrderLine) => OrderLine) =>
    setLines((current) => current.map((line) => (line.key === key ? update(line) : line))), []);
  const prices = lines.map(linePrice);
  const currencies = new Set(prices.map((p) => p.currency).filter(Boolean));
  const total = prices.every((p) => p.total != null) && currencies.size <= 1
    ? Math.round(prices.reduce((sum, p) => sum + (p.total ?? 0), 0) * 100) / 100 : null;
  const allSend = lines.every((line) => line.product?.sendsToWebsite);
  const fields = prefill.data?.fields ?? {};
  const set = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues({ ...values, [key]: event.target.value });
  const confirmText = allSend
    ? lines.length > 1
      ? t("Ruaj porosinë me {n} artikuj? Ruhet te Porositë dhe krijohet një herë te webi i biznesit.").replace("{n}", String(lines.length))
      : t("Ruaj porosinë? Ruhet te Porositë dhe krijohet një herë te webi i biznesit.")
    : lines.some((line) => line.product?.sendsToWebsite)
      ? t("Ruaj porosinë? Ruhet si e konfirmuar te Porositë. Një artikull nuk është i lidhur me webin, ndaj e gjithë porosia mbetet vetëm këtu.")
      : t("Ruaj porosinë? Ruhet si e konfirmuar te Porositë; nuk dërgohet në sistem të jashtëm.");
  return (
    <details id="krijo-porosi" className="conversation-action" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t("Krijo porosi")}</summary>
      <form
        className="conversation-form smart-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending) return;
          if (!window.confirm(confirmText)) return;
          setPending(true);
          setMessage({});
          try {
            const res = await fetch(`${base}/order`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
              lines: lines.map(lineBody),
              customer: { name: values.name, phone: values.phone, city: values.city, address: values.address },
              note: values.note,
              requestKey,
            }) });
            const json = (await res.json().catch(() => ({}))) as { error?: string; submission?: Submission };
            if (!res.ok) throw new Error(json.error || "Veprimi dështoi.");
            const text = submissionMessage(json.submission, t);
            setMessage(json.submission?.status === "rejected" || json.submission?.status === "pending_reconciliation" ? { error: text } : { success: text });
            setRequestKey(crypto.randomUUID());
            setLines([newLine()]);
            setValues((current) => ({ ...current, note: "" }));
            router.refresh();
          } catch (e) {
            setMessage({ error: e instanceof Error ? e.message : "Porosia nuk u ruajt. Provo përsëri." });
          } finally {
            setPending(false);
          }
        }}
      >
        <PrefillStatus prefill={prefill} />
        {lines.map((line, index) => (
          <OrderLineEditor key={line.key} base={base} open={open} index={index} count={lines.length} line={line} fields={fields}
            onChange={updateLine(line.key)}
            onRemove={lines.length > 1 ? () => setLines((current) => current.filter((l) => l.key !== line.key)) : undefined} />
        ))}
        {lines.length < MAX_ORDER_LINES && (
          <button type="button" className="btn btn-ghost w-full" onClick={() => setLines((current) => [...current, newLine()])}>
            {t("Shto artikull")}
          </button>
        )}
        {total != null && lines.some((line) => line.product) && (
          <p className="smart-form-total">{t("Totali")}: <strong>{total} {[...currencies][0] ?? ""}</strong></p>
        )}
        <fieldset className="smart-form-group">
          <legend>{t("Klienti dhe dërgesa")}</legend>
          <div className="smart-form-grid">
            <SmartLabel label="Emri" field={fields.name}>
              <input className="field" value={values.name} maxLength={120} autoComplete="off" onChange={set("name")} required />
            </SmartLabel>
            <SmartLabel label="Telefoni" field={fields.phone}>
              <input className="field" type="tel" value={values.phone} maxLength={40} autoComplete="off" placeholder="+355…" onChange={set("phone")} required />
            </SmartLabel>
            <SmartLabel label="Qyteti" field={fields.city}>
              <input className="field" value={values.city} maxLength={120} autoComplete="off" onChange={set("city")} />
            </SmartLabel>
            <SmartLabel label="Adresa" field={fields.address}>
              <input className="field" value={values.address} maxLength={300} autoComplete="off" onChange={set("address")} />
            </SmartLabel>
          </div>
          <SmartLabel label="Shënim" field={fields.note} wide>
            <textarea className="field" rows={2} value={values.note} maxLength={1000} placeholder={t("Masa, ngjyra, koha e dërgesës…")} onChange={set("note")} />
          </SmartLabel>
        </fieldset>
        <button type="submit" className="btn btn-primary w-full" disabled={pending || lines.some((line) => !line.productId)}>
          {pending ? t("Duke ruajtur…") : t("Ruaj porosinë")}
        </button>
        {message.error && <p role="alert" className="smart-form-error">{t(message.error)}</p>}
        {message.success && <p role="status" className="smart-form-success">{t(message.success)}</p>}
      </form>
    </details>
  );
}

/** An appointment from this conversation through the Calendar's own checks. */
export function BookingForm(props: {
  businessId: string;
  conversationId: string;
  services: { id: string; name: string }[];
  serviceId: string | null;
  date: string | null;
  time: string | null;
  name: string;
  contact: string;
}) {
  const t = useDashboardTranslator();
  const router = useRouter();
  const base = `/api/businesses/${props.businessId}/conversations/${props.conversationId}`;
  const [open, setOpen] = useHashOpen("cakto-takim");
  const prefill = usePrefill(base, "booking", open);
  const [initial] = useState({
    serviceId: props.serviceId && props.services.some((s) => s.id === props.serviceId) ? props.serviceId : "",
    date: props.date ?? "",
    time: props.time ?? "",
    name: props.name,
    contact: props.contact,
    notes: "",
  });
  const [form, setForm] = useState(initial);
  useApplyPrefill(prefill.data, { serviceId: "service_id", date: "date", time: "time", name: "name", contact: "phone", notes: "note" }, setForm, initial);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  const fields = prefill.data?.fields ?? {};
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: event.target.value });
  return (
    <details id="cakto-takim" className="conversation-action" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t("Cakto takim")}</summary>
      <form
        className="conversation-form smart-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending) return;
          setPending(true);
          setMessage({});
          try {
            const res = await fetch(`${base}/booking`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...form, requestKey }),
            });
            const json = (await res.json().catch(() => ({}))) as { error?: string; warning?: string };
            if (!res.ok) throw new Error(json.error || "Takimi nuk u ruajt.");
            setMessage({ success: json.warning || "Takimi u ruajt." });
            setRequestKey(crypto.randomUUID());
            router.refresh();
          } catch (e) {
            setMessage({ error: e instanceof Error ? e.message : "Takimi nuk u ruajt." });
          } finally {
            setPending(false);
          }
        }}
      >
        <PrefillStatus prefill={prefill} />
        <fieldset className="smart-form-group">
          <legend>{t("Takimi")}</legend>
          <SmartLabel label="Shërbimi" field={fields.service_id} wide>
            <select className="field" value={form.serviceId} onChange={set("serviceId")} required>
              <option value="">{t("Zgjidh shërbimin")}</option>
              {props.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </SmartLabel>
          <div className="smart-form-grid">
            <SmartLabel label="Data" field={fields.date}>
              <input className="field" type="date" value={form.date} onChange={set("date")} required />
            </SmartLabel>
            <SmartLabel label="Ora" field={fields.time}>
              <input className="field" type="time" value={form.time} onChange={set("time")} required />
            </SmartLabel>
          </div>
        </fieldset>
        <fieldset className="smart-form-group">
          <legend>{t("Klienti")}</legend>
          <div className="smart-form-grid">
            <SmartLabel label="Emri" field={fields.name}>
              <input className="field" value={form.name} maxLength={120} autoComplete="off" onChange={set("name")} required />
            </SmartLabel>
            <SmartLabel label="Kontakti" field={fields.phone}>
              <input className="field" value={form.contact} maxLength={200} autoComplete="off" placeholder={t("Telefoni ose email-i")} onChange={set("contact")} />
            </SmartLabel>
          </div>
          <SmartLabel label="Shënim" field={fields.note} wide>
            <textarea className="field" rows={2} value={form.notes} maxLength={1000} onChange={set("notes")} />
          </SmartLabel>
        </fieldset>
        <button type="submit" className="btn btn-primary w-full" disabled={pending || !form.serviceId}>
          {pending ? t("Duke ruajtur…") : t("Ruaj takimin")}
        </button>
        {message.error && <p role="alert" className="smart-form-error">{t(message.error)}</p>}
        {message.success && <p role="status" className="smart-form-success">{t(message.success)}</p>}
      </form>
    </details>
  );
}
