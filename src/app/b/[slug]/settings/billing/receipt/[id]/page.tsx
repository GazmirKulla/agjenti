import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadPaidPayment } from "@/lib/billing/payments";
import { plans } from "@/lib/billing/service";
import { PrintButton } from "./print-button";

export const metadata = { title: "Mandati i pagesës | Agjenti.app" };
const dateLabel = (value: string) => new Intl.DateTimeFormat("sq-AL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Tirane" }).format(new Date(value));

/**
 * A printable payment confirmation for one paid plan, only for the person who paid it. It is a receipt of
 * the card payment through POK, not a fiscal invoice; the fiscal invoice comes later with POK's documents.
 */
export default async function ReceiptPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const payment = await loadPaidPayment(user.id, id).catch(() => null);
  if (!payment) notFound();
  const rows: [string, string][] = [
    ["Numri", payment.id.slice(0, 8).toUpperCase()],
    ["Data e pagesës", dateLabel(payment.paidAt ?? payment.createdAt)],
    ["Paguesi", user.email ?? "—"],
    ["Paketa", `${plans[payment.plan].name} · ${plans[payment.plan].monthlyLimit.toLocaleString("sq-AL")} mesazhe AI në muaj`],
    ["Periudha", payment.periodStart && payment.periodEnd ? `${dateLabel(payment.periodStart)} – ${dateLabel(payment.periodEnd)}` : "—"],
    ["Mënyra", "Kartë, përmes POK"],
    ["Shuma", `${payment.amount.toLocaleString("sq-AL")} ${payment.currency === "ALL" ? "lekë" : payment.currency}`],
  ];
  return <main style={{ maxWidth: 640, margin: "24px auto", padding: "0 16px", display: "grid", gap: 16 }}>
    <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <Link className="inline-link" href={`/b/${access.business.slug}/settings/billing?tab=billing`}>← Pagesat</Link>
      <PrintButton />
    </div>
    <section className="panel section-pad grid gap-3">
      <div><h1 style={{ margin: 0 }}>Mandat pagese</h1><p className="muted-copy">Agjenti.app · konfirmim i pagesës me kartë</p></div>
      <table className="data-table"><tbody>{rows.map(([label, value]) => <tr key={label}><th style={{ width: "40%" }}>{label}</th><td>{value}</td></tr>)}</tbody></table>
      <p className="muted-copy">Ky dokument konfirmon pagesën e paketës. Nuk është faturë tatimore.</p>
    </section>
    <style>{"@media print { .no-print, nav, aside, header { display: none !important; } main { margin: 0 !important; } }"}</style>
  </main>;
}
