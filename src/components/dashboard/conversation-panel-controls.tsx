"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useDashboardTranslator } from "@/components/dashboard/language";
import type { LeadStatus } from "@/lib/leads/model";

async function post(url: string, body: object) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error || "Veprimi dështoi.");
}

/** Creates the CRM customer from the details the agent collected; the owner can correct them first. */
export function SaveCustomerForm(props: { businessId: string; conversationId: string; name: string; phone: string }) {
  const t = useDashboardTranslator();
  const router = useRouter();
  const [name, setName] = useState(props.name);
  const [phone, setPhone] = useState(props.phone);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="conversation-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending) return;
        setPending(true);
        setError(null);
        try {
          await post(`/api/businesses/${props.businessId}/conversations/${props.conversationId}/customer`, { name: name.trim(), phone: phone.trim() });
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Shtimi i klientit dështoi.");
        } finally {
          setPending(false);
        }
      }}
    >
      <label>{t("Emri")}<input className="field" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
      <label>{t("Telefoni")}<input className="field" type="tel" value={phone} maxLength={40} onChange={(e) => setPhone(e.target.value)} /></label>
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? t("Duke ruajtur…") : t("Ruaj si klient")}
      </button>
      {error && <p role="alert" className="muted-copy text-red-600">{t(error)}</p>}
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

type ProductOption = { id: string; name: string; price: number | null; currency: string | null };

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

/** A LOCAL order from this conversation; the server takes the price from the catalog. */
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
  const [query, setQuery] = useState(props.productName ?? "");
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [productId, setProductId] = useState(props.productId ?? "");
  const [quantity, setQuantity] = useState(String(props.quantity));
  const [customer, setCustomer] = useState(props.customer);
  const [note, setNote] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  useEffect(() => {
    if (!open) return;
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
  }, [open, query, base]);
  const selected = products.find((p) => p.id === productId);
  const total = selected?.price != null ? selected.price * (Number(quantity) || 0) : null;
  const set = (key: keyof typeof customer) => (event: React.ChangeEvent<HTMLInputElement>) => setCustomer({ ...customer, [key]: event.target.value });
  return (
    <details id="krijo-porosi" className="conversation-action" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t("Krijo porosi")}</summary>
      <form
        className="conversation-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending) return;
          if (!window.confirm(t("Ruaj porosinë? Ruhet si e konfirmuar te Porositë; nuk dërgohet në sistem të jashtëm."))) return;
          setPending(true);
          setMessage({});
          try {
            await post(`${base}/order`, { productId, quantity: Number(quantity), customer, note, requestKey });
            setMessage({ success: "Porosia u ruajt." });
            setRequestKey(crypto.randomUUID());
            setNote("");
            router.refresh();
          } catch (e) {
            setMessage({ error: e instanceof Error ? e.message : "Porosia nuk u ruajt. Provo përsëri." });
          } finally {
            setPending(false);
          }
        }}
      >
        <label>{t("Kërko produktin")}<input className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Emri i produktit")} /></label>
        <label>
          {t("Produkti")}
          <select className="field" value={productId} onChange={(e) => setProductId(e.target.value)} required>
            <option value="">{t("Zgjidh produktin")}</option>
            {productId && !selected && <option value={productId}>{props.productName ?? t("Produkti i zgjedhur nga biseda")}</option>}
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.price != null ? ` · ${p.price} ${p.currency ?? ""}` : ""}</option>
            ))}
          </select>
        </label>
        <label>{t("Sasia")}<input className="field" type="number" min={1} max={999} value={quantity} onChange={(e) => setQuantity(e.target.value)} required /></label>
        <label>{t("Emri")}<input className="field" value={customer.name} maxLength={120} onChange={set("name")} required /></label>
        <label>{t("Telefoni")}<input className="field" type="tel" value={customer.phone} maxLength={40} onChange={set("phone")} required /></label>
        <label>{t("Qyteti")}<input className="field" value={customer.city} maxLength={120} onChange={set("city")} /></label>
        <label>{t("Adresa")}<input className="field" value={customer.address} maxLength={300} onChange={set("address")} /></label>
        <label>{t("Shënim")}<input className="field" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></label>
        {total != null && <p className="muted-copy">{t("Totali")}: {total} {selected?.currency}</p>}
        <button type="submit" className="btn btn-primary w-full" disabled={pending || !productId}>
          {pending ? t("Duke ruajtur…") : t("Ruaj porosinë")}
        </button>
        {message.error && <p role="alert" className="muted-copy text-red-600">{t(message.error)}</p>}
        {message.success && <p role="status" className="muted-copy">{t(message.success)}</p>}
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
  const [open, setOpen] = useHashOpen("cakto-takim");
  const [form, setForm] = useState({
    serviceId: props.serviceId && props.services.some((s) => s.id === props.serviceId) ? props.serviceId : props.services[0]?.id ?? "",
    date: props.date ?? "",
    time: props.time ?? "",
    name: props.name,
    contact: props.contact,
    notes: "",
  });
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [key]: event.target.value });
  return (
    <details id="cakto-takim" className="conversation-action" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t("Cakto takim")}</summary>
      <form
        className="conversation-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending) return;
          setPending(true);
          setMessage({});
          try {
            const res = await fetch(`/api/businesses/${props.businessId}/conversations/${props.conversationId}/booking`, {
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
        <label>
          {t("Shërbimi")}
          <select className="field" value={form.serviceId} onChange={set("serviceId")} required>
            {props.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>{t("Data")}<input className="field" type="date" value={form.date} onChange={set("date")} required /></label>
        <label>{t("Ora")}<input className="field" type="time" value={form.time} onChange={set("time")} required /></label>
        <label>{t("Emri")}<input className="field" value={form.name} maxLength={120} onChange={set("name")} required /></label>
        <label>{t("Kontakti")}<input className="field" value={form.contact} maxLength={200} onChange={set("contact")} /></label>
        <label>{t("Shënim")}<input className="field" value={form.notes} maxLength={1000} onChange={set("notes")} /></label>
        <button type="submit" className="btn btn-primary w-full" disabled={pending || !form.serviceId}>
          {pending ? t("Duke ruajtur…") : t("Ruaj takimin")}
        </button>
        {message.error && <p role="alert" className="muted-copy text-red-600">{t(message.error)}</p>}
        {message.success && <p role="status" className="muted-copy">{t(message.success)}</p>}
      </form>
    </details>
  );
}
