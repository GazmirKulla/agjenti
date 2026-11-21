"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BusinessAvatar } from "@/components/dashboard/business-avatar";
import { deleteBusinessLogo, uploadBusinessLogo } from "@/lib/businesses/logo-actions";

const MAX_SIDE = 512;
const KEEP_AS_IS = 1_000_000;

/** A logo made small enough to send and to show: at most 512 px on its long side. */
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
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // PNG keeps a transparent background; a logo this small stays well under the limit.
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("encode");
  return new File([blob], "logo.png", { type: "image/png" });
}

/**
 * The business's logo in Cilësimet: upload one from the device, or remove it. Without an uploaded
 * logo the connected Instagram account's profile photo is used, and without that the initials.
 */
export function BusinessLogoSettings({ slug, name, logoUrl, source, instagramConnected, available }: {
  slug: string;
  name: string;
  logoUrl: string | null;
  source: "instagram" | "manual" | null;
  instagramConnected: boolean;
  /** False before the migration: the section explains instead of offering an upload that would fail. */
  available: boolean;
}) {
  const router = useRouter();
  const picker = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  function upload(file: File | undefined) {
    if (!file) return;
    setMessage(null);
    start(async () => {
      let ready: File;
      try { ready = await shrink(file); }
      catch { setMessage({ tone: "error", text: "Fotoja nuk u lexua. Provo një JPG ose PNG." }); return; }
      const data = new FormData();
      data.set("file", ready);
      const result = await uploadBusinessLogo(slug, data);
      setMessage("error" in result ? { tone: "error", text: result.error } : { tone: "ok", text: result.success });
      if (!("error" in result)) router.refresh();
    });
  }
  function remove() {
    setMessage(null);
    start(async () => {
      const result = await deleteBusinessLogo(slug);
      setMessage("error" in result ? { tone: "error", text: result.error } : { tone: "ok", text: result.success });
      if (!("error" in result)) router.refresh();
    });
  }

  const origin = source === "manual" ? "E ngarkuar nga ti."
    : source === "instagram" ? "Foto e profilit të Instagram-it; përditësohet vetë çdo javë."
    : instagramConnected ? "Foto e Instagram-it do të merret automatikisht brenda ditës."
    : "Pa logo, paneli tregon inicialet. Kur lidh Instagram-in, foto e profilit merret vetë.";

  return <section className="panel section-pad business-logo-settings" aria-labelledby="business-logo-title">
    <BusinessAvatar name={name} logoUrl={logoUrl} size={64} />
    <div className="business-logo-text">
      <h2 id="business-logo-title">Logoja</h2>
      <p className="muted-copy">{available ? origin : "Logoja do të jetë e disponueshme pas përditësimit të databazës."}</p>
      {message && <p className={message.tone === "error" ? "text-sm text-danger" : "muted-copy"} role="status">{message.text}</p>}
    </div>
    {available && <div className="business-logo-actions">
      <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={event => { upload(event.target.files?.[0]); event.target.value = ""; }} />
      <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => picker.current?.click()}>{pending ? "Duke ruajtur…" : logoUrl ? "Ndrysho" : "Ngarko logo"}</button>
      {source === "manual" && <button type="button" className="btn btn-ghost" disabled={pending} onClick={remove}>Hiq</button>}
    </div>}
  </section>;
}
