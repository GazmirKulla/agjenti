"use client";

import { useState, type ChangeEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ActionForm } from "@/components/dashboard/action-form";
import { Icon } from "@/components/dashboard/icon";
import { ImportProductLink } from "@/components/dashboard/import-product-link";
import { ProductFields } from "@/components/dashboard/product-fields";
import { ProductReview, type ReviewDraft } from "@/components/dashboard/product-review";
import { parseProductCsv, type CsvProduct } from "@/lib/products/csv";

const METHODS = [
  { id: "manual", title: "Dorazi", hint: "Shkruaj emrin dhe çmimin", icon: "spark" },
  { id: "url", title: "Nga linku", hint: "Skano faqen e produktit", icon: "search" },
  { id: "csv", title: "Skedar CSV", hint: "Ngarko një listë", icon: "orders" },
  { id: "instagram", title: "Instagram", hint: "Një llogari publike", icon: "instagram" },
] as const;

type MethodId = (typeof METHODS)[number]["id"];
type Option = { id: string; name: string };
type NoticeState = { error?: string; success?: string } | null;
type ImportAction = (payload: {
  items: unknown;
  productTypeId?: string | null;
  workflowId?: string | null;
}) => Promise<{ error?: string; success?: string }>;
type ScanProduct = {
  externalId: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  imageUrl: string | null;
  permalink: string | null;
};

export function ProductIntake({
  slug,
  types,
  workflows,
  instagramStatus,
  instagramUsername,
  createAction,
  previewAction,
  scanAction,
  importAction,
}: {
  slug: string;
  types: Option[];
  workflows: Option[];
  instagramStatus: string | null;
  instagramUsername: string | null;
  createAction: (data: FormData) => Promise<{ error?: string; success?: string } | void>;
  previewAction: (data: FormData) => Promise<{
    error?: string;
    success?: string;
    product?: {
      name: string;
      description: string | null;
      price: number | null;
      currency: string | null;
      imageUrl: string | null;
      sku: string | null;
    };
  }>;
  scanAction: (account: string) => Promise<{ error?: string; success?: string; products?: ScanProduct[] }>;
  importAction: ImportAction;
}) {
  const [method, setMethod] = useState<MethodId>("manual");
  const csv = useBatchSave(importAction);
  const instagram = useBatchSave(importAction);
  const [scanning, setScanning] = useState(false);
  const [publicAccount, setPublicAccount] = useState("");
  const connected = instagramStatus === "connected";

  function onTabsKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const index = METHODS.findIndex((item) => item.id === method);
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = METHODS[(index + delta + METHODS.length) % METHODS.length];
    setMethod(next.id);
    document.getElementById(`product-tab-${next.id}`)?.focus();
  }

  async function scanInstagram() {
    const account = publicAccount.trim();
    if (!account) {
      instagram.setNotice({ error: "Shkruaj llogarinë publike, p.sh. @dyqani." });
      return;
    }
    setScanning(true);
    instagram.setNotice(null);
    try {
      const result = await scanAction(account);
      if (result.error || !result.products?.length) {
        instagram.setRows([]);
        instagram.setNotice({ error: result.error || "Nuk gjeta produkte në postime." });
      } else {
        instagram.setRows(result.products.map(draftFromInstagram));
        instagram.setNotice({ success: result.success || "Kontrolloje listën, pastaj ruaji." });
      }
    } catch {
      instagram.setNotice({ error: "Skanimi dështoi. Provo përsëri." });
    } finally {
      setScanning(false);
    }
  }

  function onCsvFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 512 * 1024) {
      csv.setRows([]);
      csv.setNotice({ error: "Skedari është më i madh se 512 KB." });
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => csv.setNotice({ error: "Skedari nuk u lexua." });
    reader.onload = () => {
      const parsed = parseProductCsv(String(reader.result ?? ""));
      if ("error" in parsed) {
        csv.setRows([]);
        csv.setNotice({ error: parsed.error });
        return;
      }
      csv.setRows(draftsFromCsv(parsed.rows));
      const count = parsed.rows.length;
      csv.setNotice({
        success:
          count === 1
            ? `U lexua 1 rresht nga ${fileLabel(file.name)}. Kontrolloje, pastaj ruaje.`
            : `U lexuan ${count} rreshta nga ${fileLabel(file.name)}. Hiq ato që nuk duhen, pastaj ruaji.`,
      });
    };
    reader.readAsText(file);
  }

  return (
    <section className="panel section-pad product-intake">
      <div className="product-intake-head">
        <h2>Shto produkte</h2>
        <p className="muted-copy">Zgjidh mënyrën. Katalogu përditësohet vetëm kur ruan.</p>
      </div>
      <div role="tablist" aria-label="Mënyra e shtimit" className="product-methods" onKeyDown={onTabsKeyDown}>
        {METHODS.map((item) => (
          <button
            key={item.id}
            id={`product-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={method === item.id}
            aria-controls={`product-panel-${item.id}`}
            tabIndex={method === item.id ? 0 : -1}
            className={method === item.id ? "product-method is-active" : "product-method"}
            onClick={() => setMethod(item.id)}
          >
            <span className="product-method-icon">
              <Icon name={item.icon} size={18} />
            </span>
            <strong>{item.title}</strong>
            <small>{item.hint}</small>
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="product-panel-manual"
        aria-labelledby="product-tab-manual"
        hidden={method !== "manual"}
        className="product-method-panel"
      >
        <p className="muted-copy">Plotëso fushat dhe ruaje. Përshkrimin mund ta gjenerosh me AI nga emri.</p>
        <ActionForm action={createAction} className="grid gap-5">
          <ProductFields slug={slug} types={types} workflows={workflows} />
          <button className="btn btn-primary" type="submit">
            Ruaj produktin
          </button>
        </ActionForm>
      </div>

      <div
        role="tabpanel"
        id="product-panel-url"
        aria-labelledby="product-tab-url"
        hidden={method !== "url"}
        className="product-method-panel"
      >
        <p className="muted-copy">
          Ngjit linkun e faqes së produktit, nga çdo dyqan. Kontrollo emrin, çmimin dhe përshkrimin, pastaj ruaje.
        </p>
        <ActionForm action={createAction} className="grid gap-5">
          <ImportProductLink action={previewAction} quiet />
          <ProductFields slug={slug} types={types} workflows={workflows} />
          <button className="btn btn-primary" type="submit">
            Ruaj produktin
          </button>
        </ActionForm>
      </div>

      <div
        role="tabpanel"
        id="product-panel-csv"
        aria-labelledby="product-tab-csv"
        hidden={method !== "csv"}
        className="product-method-panel"
      >
        <p className="muted-copy">
          Kolonat: emri, cmimi, monedha, pershkrimi, sku, foto. Ndarësi mund të jetë presje ose pikëpresje, si në Excel.
          Zgjidh rreshtat dhe ruaji.
        </p>
        <div className="import-link-row">
          <label className="btn btn-ghost">
            Zgjidh CSV
            <input
              className="sr-only"
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={onCsvFile}
            />
          </label>
          <button type="button" className="btn btn-ghost" onClick={downloadSample}>
            Shkarko një shembull
          </button>
        </div>
        <Notice notice={csv.notice} />
        {csv.rows.length > 0 ? (
          <ProductReview
            rows={csv.rows}
            onChange={csv.setRows}
            types={types}
            workflows={workflows}
            pending={csv.saving}
            onSave={csv.save}
          />
        ) : null}
      </div>

      <div
        role="tabpanel"
        id="product-panel-instagram"
        aria-labelledby="product-tab-instagram"
        hidden={method !== "instagram"}
        className="product-method-panel"
      >
        <p className="muted-copy">{instagramIntro(instagramStatus, instagramUsername)}</p>
        {connected ? (
          <div className="import-link-row">
            <input
              className="field"
              value={publicAccount}
              onChange={(event) => setPublicAccount(event.target.value)}
              placeholder="@dyqani ose https://instagram.com/dyqani"
              aria-label="Llogaria publike e Instagram"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={200}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || scanning || instagram.saving) return;
                event.preventDefault();
                void scanInstagram();
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={scanning || instagram.saving}
              onClick={scanInstagram}
            >
              {scanning ? "Duke lexuar…" : "Skano llogarinë"}
            </button>
          </div>
        ) : (
          <Link href={`/b/${slug}/instagram`} className="btn btn-primary">
            Hap Instagram
          </Link>
        )}
        <Notice notice={instagram.notice} />
        {instagram.rows.length > 0 ? (
          <ProductReview
            rows={instagram.rows}
            onChange={instagram.setRows}
            types={types}
            workflows={workflows}
            pending={instagram.saving}
            onSave={instagram.save}
          />
        ) : null}
      </div>
    </section>
  );
}

function useBatchSave(importAction: ImportAction) {
  const router = useRouter();
  const [rows, setRows] = useState<ReviewDraft[]>([]);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [saving, setSaving] = useState(false);

  async function save(payload: {
    items: unknown[];
    productTypeId: string;
    workflowId: string;
  }) {
    if (!payload.items.length) {
      setNotice({ error: "Zgjidh të paktën një produkt me emër të vlefshëm." });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const result = await importAction({
        items: payload.items,
        productTypeId: payload.productTypeId || null,
        workflowId: payload.workflowId || null,
      });
      if (result.error) {
        setNotice({ error: result.error });
      } else {
        setRows([]);
        setNotice({ success: result.success || "Produktet u ruajtën." });
        router.refresh();
      }
    } catch {
      setNotice({ error: "Ruajtja nuk u përfundua. Provo përsëri." });
    } finally {
      setSaving(false);
    }
  }

  return { rows, setRows, notice, setNotice, saving, save };
}

function Notice({ notice }: { notice: NoticeState }) {
  if (notice?.error) {
    return (
      <p role="alert" className="form-feedback form-feedback-error">
        {notice.error}
      </p>
    );
  }
  if (notice?.success) {
    return (
      <p role="status" className="form-feedback form-feedback-success">
        {notice.success}
      </p>
    );
  }
  return null;
}

function draftsFromCsv(rows: CsvProduct[]): ReviewDraft[] {
  return rows.map((row) => ({
    key: `csv-${row.line}`,
    selected: !row.invalidPrice && row.name.trim().length >= 2,
    name: row.name,
    price: row.priceText,
    currency: row.currency,
    description: row.description ?? "",
    sku: row.sku ?? "",
    imageUrl: row.imageUrl ?? "",
    sourceLabel: `Rreshti ${row.line}`,
  }));
}

function draftFromInstagram(product: ScanProduct): ReviewDraft {
  return {
    key: product.externalId,
    selected: true,
    name: product.name,
    price: Number.isInteger(product.price) ? String(product.price) : product.price.toFixed(2),
    currency: product.currency || "ALL",
    description: product.description ?? "",
    sku: "",
    imageUrl: product.imageUrl ?? "",
    sourceLabel: "Postim",
    externalId: product.externalId,
    permalink: product.permalink,
  };
}

function instagramIntro(status: string | null, username: string | null): string {
  if (status === "connected") {
    const handle = username?.replace(/^@/, "").trim();
    const linked = handle ? ` Lidhja @${handle} qëndron vetëm që Instagram ta pranojë kërkimin.` : "";
    return `Shkruaj një llogari publike. Lexohen postimet e asaj llogarie, jo të llogarisë sate. Duhet të jetë Business ose Creator dhe publike. Një postim bëhet produkt kur në tekst ka çmim.${linked}`;
  }
  if (status === "expired") {
    return "Lidhja e Instagram ka skaduar. Lidhe përsëri, pastaj shkruaj llogarinë publike që do të skanosh.";
  }
  if (status === "revoked") return "Lidhja e Instagram është hequr. Lidhe përsëri llogarinë.";
  return "Lidh një llogari profesionale të Instagram. Pastaj këtu shkruan llogarinë publike që do të skanosh.";
}

function fileLabel(name: string): string {
  const text = name.trim();
  if (!text) return "skedarit";
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

function downloadSample() {
  const content =
    "\uFEFFemri,cmimi,monedha,pershkrimi,sku,foto\nFilizat Hapi 2,790,ALL,Paketë me 140 faqe,FIL-2,\n";
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "produkte-shembull.csv";
  link.click();
  URL.revokeObjectURL(url);
}
