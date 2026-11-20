import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeading } from "@/components/dashboard/ui";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { loadFailure } from "@/lib/tracking/health";
import { capabilities } from "@/lib/tracking/capabilities";
import { capabilityName, exitLabel, failureKind, failureKindLabels, reasonHelp } from "@/lib/tracking/labels";
import s from "../../health.module.css";

export const metadata = { title: "Dështimi | Shëndeti i Agjentit" };
const when = (value: string) => new Intl.DateTimeFormat("sq-AL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Tirane" }).format(new Date(value));
const roles: Record<string, string> = { user: "Pronari", assistant: "Asistenti" };

/** Platform Admin: one failure, its cause, the steps of the same request, and what the owner asked. */
export default async function FailurePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/auth/continue");
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const found = await loadFailure(id);
  if (!found) notFound();
  const { event, trail, turn } = found;
  const { data: business } = event.businessId ? await createServiceSupabase().from("businesses").select("name,slug").eq("id", event.businessId).maybeSingle() : { data: null };
  const kind = failureKind(event.reason);
  const code = event.reason ? event.reason.slice(event.reason.lastIndexOf(":") + 1) : "";
  const name = capabilityName(event.capability, capabilities[event.capability]?.label ?? event.capability);

  return <div className={s.detail}>
    <PageHeading eyebrow="SHËNDETI I AGJENTIT" title={name} description={exitLabel(event.point, event.reason)} />
    <Link href="/admin/health" className="btn btn-ghost" style={{ justifySelf: "start" }}>← Shëndeti i Agjentit</Link>
    <section className="panel section-pad grid gap-3">
      <span className={`${s.kind} ${s[`kind_${kind}`]}`} style={{ justifySelf: "start" }}>{failureKindLabels[kind]}</span>
      <p>{reasonHelp[code] ?? (kind === "external" ? "Shërbimi tjetër e refuzoi kërkesën me këtë kod. Kodi tregon arsyen te dokumentimi i atij shërbimi." : "Kod i panjohur; shiko log-un e serverit.")}</p>
      <dl className={s.facts}>
        <div><dt>Kur</dt><dd>{when(event.createdAt)}</dd></div>
        <div><dt>Biznesi</dt><dd>{business?.name ?? event.businessId ?? "Platforma"}</dd></div>
        <div><dt>Hapi</dt><dd>{event.point}</dd></div>
        <div><dt>Kodi</dt><dd>{event.reason ?? "—"}</dd></div>
        <div><dt>Aftësia</dt><dd>{event.capability}</dd></div>
        {event.durationMs !== null && <div><dt>Zgjati</dt><dd>{(event.durationMs / 1000).toLocaleString("sq-AL")} s</dd></div>}
      </dl>
      {event.conversationId && business?.slug && <Link className="btn btn-ghost" style={{ justifySelf: "start" }} href={`/b/${business.slug}/inbox/${event.conversationId}`}>Hap bisedën me klientin</Link>}
    </section>

    {event.agent === "assistant" && <section className="panel section-pad grid gap-3">
      <h2>Çfarë kërkoi pronari</h2>
      {!turn ? <p className="muted-copy">Kërkesa nuk u gjet (mund të jetë fshirë ose ka skaduar).</p> : <>
        {turn.matched === "time" && <p className="muted-copy">Ky dështim u regjistrua para se ngjarjet të lidheshin me kërkesën: kjo është kërkesa e fundit e biznesit para dështimit, e gjetur sipas orës.</p>}
        <div className={s.turn}>{turn.messages.map((m, i) => <div key={i} className={s.bubble}><small>{roles[m.role] ?? m.role} · {when(m.at)}</small>{m.content}</div>)}</div>
      </>}
    </section>}

    {trail.length > 1 && <section className="panel section-pad grid gap-2">
      <h2>Hapat e së njëjtës kërkesë</h2>
      <ol className={s.trail}>{trail.map(t => <li key={t.id}>{when(t.createdAt)} · {exitLabel(t.point, t.reason)}{t.durationMs !== null ? ` · ${(t.durationMs / 1000).toLocaleString("sq-AL")} s` : ""}</li>)}</ol>
    </section>}

    {kind === "bug" && <section className="panel section-pad grid gap-2">
      <h2>Ku ta kërkosh</h2>
      <p className="muted-copy">Për dështimet e regjistruara pas 20 nëntorit, log-u i serverit (Vercel → Logs) ka rreshtin <code>capability_unexpected_failure</code> me <code>ref</code> “{event.ref ?? "—"}”, emrin e gabimit dhe vendin në kod.</p>
    </section>}
  </div>;
}
