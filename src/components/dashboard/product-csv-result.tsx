import Link from "next/link";
import type { ImportPreview } from "@/lib/products/import-model";
import { Icon } from "./icon";

export function ProductCsvResult({ preview, saved, slug, busy, onDetails, onNew }: {
  preview: ImportPreview; saved?: string; slug: string; busy: boolean; onDetails: () => void; onNew: () => void;
}) {
  const created = preview.rows.filter(row => row.status === "create").length;
  const updated = preview.rows.filter(row => row.status === "update").length;
  const conflicts = preview.rows.filter(row => row.status === "conflict").length;
  const changes = created + updated;
  const summary = [created && `${created} produkte të reja`, updated && `${updated} përditësime`].filter(Boolean).join(" · ");
  return <div className="csv-result">
    <div className="csv-result-title" role="status"><Icon name={conflicts && !saved ? "file" : "check"} size={19}/><strong>{saved ? "Importi u ruajt" : conflicts ? "Disa produkte kërkojnë korrigjim" : changes ? "Ndryshimet janë gati" : "Katalogu është i përditësuar"}</strong></div>
    <p>{saved ? summary : conflicts ? `${conflicts} produkte kanë konflikte. Kontrolloji përpara ruajtjes.` : changes ? summary : "Të dhënat e zgjedhura përputhen me katalogun. Nuk nevojitet ruajtje."}</p>
    {!saved && changes > 0 && !conflicts && <small>Ruajtja bëhet vetëm pasi t’i miratosh.</small>}
    <div className="csv-result-actions">
      {saved ? <><Link className="btn btn-primary" href={`/b/${slug}/products`}>Shiko produktet</Link><button type="button" className="csv-text-button" onClick={onNew}>Ngarko tjetër</button></> : <button type="button" className={changes || conflicts ? "btn btn-primary" : "csv-text-button"} disabled={busy} onClick={onDetails}>{conflicts ? "Shiko korrigjimet" : changes ? "Rishiko ndryshimet" : "Shiko detajet"}</button>}
    </div>
    {saved && <button type="button" className="csv-text-button" onClick={onDetails}>Shiko çfarë u ruajt</button>}
  </div>;
}
