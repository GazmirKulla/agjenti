"use client";
import { useRef, useState } from "react";
import { Icon } from "@/components/dashboard/icon";
import { uploadProductImage } from "@/lib/products/image-actions";

const MAX_SIDE = 1600;
const KEEP_AS_IS = 1_500_000;

/** A phone photo made small enough to send: at most 1600 px on its long side, JPEG. */
async function shrink(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= KEEP_AS_IS && ["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("encode");
  return new File([blob], "foto.jpg", { type: "image/jpeg" });
}

/**
 * The product's photo, changed in place: upload one from the device or paste its link.
 * Either way the link is the form's image_url and is saved with the product.
 */
export function ProductPhoto({ slug, initial, name, onChange }: { slug: string; initial: string; name: string; onChange: (url: string) => void }) {
  const [url, setUrl] = useState(initial);
  const [linkOpen, setLinkOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const set = (next: string) => { setUrl(next); onChange(next); };
  const shown = /^https?:\/\//.test(url);

  async function upload(file: File) {
    setError("");
    setBusy(true);
    try {
      const data = new FormData();
      data.set("file", await shrink(file));
      const result = await uploadProductImage(slug, data);
      if ("error" in result) setError(result.error);
      else { set(result.url); setLinkOpen(false); }
    } catch {
      setError("Fotoja nuk u lexua. Provo një foto tjetër.");
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = "";
    }
  }

  return <section className="panel section-pad product-photo" aria-label="Foto e produktit" id="product-media">
    <h2>Foto</h2>
    <button type="button" className={`product-photo-frame${shown ? " has-photo" : ""}`} disabled={busy}
      onClick={() => picker.current?.click()} aria-label={shown ? "Ndrysho foton" : "Ngarko foto"}>
      {shown ? <img src={url} alt={name || "Foto e produktit"} /> : <span className="product-photo-empty">
        <Icon name="image" size={28} />
        <span>Ngarko foto</span>
        <small>JPG, PNG ose WebP</small>
      </span>}
      {busy && <span className="product-photo-busy" role="status">Duke ngarkuar…</span>}
    </button>
    <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden
      onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file); }} />
    <div className="product-photo-actions">
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => picker.current?.click()}>
        <Icon name="image" size={16} /> {shown ? "Ndrysho" : "Ngarko"}
      </button>
      <button type="button" className="btn btn-ghost" aria-expanded={linkOpen} disabled={busy} onClick={() => setLinkOpen(open => !open)}>
        <Icon name="link" size={16} /> URL
      </button>
      {url && <button type="button" className="btn btn-ghost product-photo-remove" disabled={busy} onClick={() => set("")} aria-label="Hiq foton">
        <Icon name="trash" size={16} />
      </button>}
    </div>
    <label className="form-label" hidden={!linkOpen}>
      URL e fotos
      <input name="image_url" type="url" className="field" placeholder="https://" value={url}
        onChange={e => set(e.target.value)} />
    </label>
    {error && <p role="alert" className="form-feedback-error">{error}</p>}
  </section>;
}
