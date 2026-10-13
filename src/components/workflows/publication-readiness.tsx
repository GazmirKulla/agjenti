import type { PublicationReadiness, PublicationReceipt } from "@/lib/workflows/visual/publication-types";

const labels: Record<PublicationReadiness["status"], string> = {
  ready: "Gati për publikim", needs_setup: "Kërkon konfigurim", simulation_failed: "Simulimi dështoi",
  unverified_external_action: "Veprim i jashtëm ose sjellje e paverifikuar", stale_proposal: "Propozim i vjetruar",
  approval_required: "Gati për publikim · kërkohet miratim", blocked: "Publikimi është i bllokuar",
};
export function PublicationReadinessView({ publication }: { publication: PublicationReadiness }) {
  return <section aria-label="Gatishmëria e publikimit" style={{ padding: "12px", margin: "12px 0", border: "1px solid #c7ceda", borderRadius: "8px", overflowWrap: "anywhere" }}>
    <strong>{labels[publication.status]}</strong><p>Kontrolli: {publication.result} · revisioni {publication.baseRevision}</p>
    {publication.findings.map(f => <p key={f.code}>{f.message}</p>)}
    <small>Ky është vlerësim, jo konfirmim publikimi. Bisedat aktive ruajnë versionin e tyre.</small>
  </section>;
}
export function PublicationReceiptView({ receipt }: { receipt: PublicationReceipt }) {
  return <section aria-label="Konfirmimi i publikimit"><strong>Publikimi u konfirmua nga serveri · revisioni {receipt.revision}</strong>
    {receipt.publishedVersionId && <p>Versioni: {receipt.publishedVersionId}</p>}
    {receipt.publishedAt && <p>Koha: {receipt.publishedAt}</p>}
    {receipt.actorId && <p>Miratuar nga: {receipt.actorId}</p>}
    {receipt.warning && <p>{receipt.warning}</p>}
    <p>Rikthimi i një versioni krijon draft dhe kërkon publikim të veçantë.</p>
  </section>;
}
