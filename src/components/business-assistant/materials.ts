"use client";
import { useEffect, useRef, useState } from "react";
import type { ComposerItem } from "./composer";
export type MaterialDraft = ComposerItem & { file?: File; url?: string; token?: string };
export function useMaterialDraft() {
  const [materials, setMaterials] = useState<MaterialDraft[]>([]);
  const [materialError, setMaterialError] = useState("");
  const [sending, setSending] = useState(false);
  const urls = useRef(new Set<string>());
  useEffect(() => { const current = urls.current; return () => { for (const url of current) URL.revokeObjectURL(url); }; }, []);
  function addFiles(files: File[]) {
    if (sending) return;
    const valid = files.filter(file => file.size > 0 && file.size <= 3 * 1024 * 1024 && /\.(jpe?g|png|webp|pdf|txt|md|csv|json)$/i.test(file.name));
    setMaterialError(valid.length !== files.length ? "Përdor foto, PDF, TXT, MD, CSV ose JSON deri në 3 MB." : "");
    if (materials.length + valid.length > 3) { setMaterialError("Mund të shtosh deri në 3 materiale."); return; }
    const added = valid.map(file => { const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined; if (preview) urls.current.add(preview); return { id: crypto.randomUUID(), name: file.name, file, preview }; });
    setMaterials(current => [...current, ...added]);
  }
  function addLink(url: string) {
    if (sending) return;
    if (materials.length >= 3) { setMaterialError("Mund të shtosh deri në 3 materiale."); return; }
    setMaterialError("");
    setMaterials(current => current.some(item => item.url === url) ? current : [...current, { id: crypto.randomUUID(), name: url, url }]);
  }
  function removeMaterial(id: string) {
    if (sending) return;
    const item = materials.find(item => item.id === id);
    if (item?.preview) { URL.revokeObjectURL(item.preview); urls.current.delete(item.preview); }
    setMaterials(current => current.filter(item => item.id !== id));
    setMaterialError("");
  }
  return { materials, setMaterials, materialError, setMaterialError, sending, setSending, addFiles, addLink, removeMaterial };
}
