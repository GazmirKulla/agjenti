"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function CreateCatalog({ slug }: { slug: string }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const router = useRouter();
  return (
    <form
      id="catalog-create"
      className="panel catalog-create"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const form = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        try {
          const r = await fetch(
            `/api/catalogs?slug=${encodeURIComponent(slug)}`,
            { method: "POST", body: form },
          );
          const d = await r.json();
          if (!r.ok) throw new Error(d.error);
          router.push(`/b/${slug}/catalogs/${d.id}`);
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Ngarkimi dështoi.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Shto katalog</h2>
      <p>
        PDF, broshurë, listë çmimesh ose dokument teknik. Produktet nuk
        importohen automatikisht.
      </p>
      <fieldset disabled={busy} className="catalog-stack">
        <label className="form-label">
          Titulli
          <input className="field" name="title" required maxLength={180} />
        </label>
        <label className="form-label">
          Ngarko dokument
          <input
            className="field"
            type="file"
            name="file"
            accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
          />
          <small>PDF, TXT ose Markdown · deri 10 MB</small>
        </label>
        <label className="form-label">
          Ose shto link
          <input
            className="field"
            type="url"
            name="url"
            placeholder="https://kompania.com/katalog.pdf"
          />
        </label>
        <label>
          <input type="checkbox" name="scan" /> Skano website-in dhe faqet
          përkatëse (deri 8 faqe)
        </label>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Duke ngarkuar…" : "Krijo draftin"}
        </button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
export function IndexCatalog({
  slug,
  id,
  indexing,
}: {
  slug: string;
  id: string;
  indexing: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const router = useRouter();
  return (
    <div className="catalog-stack">
      <button
        className="btn btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage("Po lexojmë dokumentin dhe përgatisim indeksin…");
          try {
            const r = await fetch(
              `/api/catalogs/${id}/index?slug=${encodeURIComponent(slug)}`,
              { method: "POST" },
            );
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            setMessage(
              "Indeksi është gati. Kontrollo përmbajtjen dhe konfirmo.",
            );
          } catch (e) {
            setMessage(e instanceof Error ? e.message : "Analiza dështoi.");
          } finally {
            setBusy(false);
            router.refresh();
          }
        }}
      >
        {busy
          ? "Duke analizuar…"
          : indexing
            ? "Kontrollo / riprovo analizën"
            : "Plotëso me AI · Indekso dokumentin"}
      </button>
      <p role="status">
        {message ||
          "Riindeksimi çaktivizon katalogun deri në rishikimin e ri. Nëse analiza ndërpritet, mund ta riprovosh pas 5 minutash."}
      </p>
    </div>
  );
}
