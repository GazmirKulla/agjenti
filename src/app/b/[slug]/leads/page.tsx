import Link from "next/link";
import { PageHeading } from "@/components/dashboard/ui";
import { ActionForm } from "@/components/dashboard/action-form";
import { LeadStatusButtons } from "@/components/dashboard/lead-status";
import { requireEnabledModule } from "@/lib/dashboard/modules/permissions";
import { createServiceSupabase } from "@/lib/supabase/service";
import { saveLeadSettings } from "@/lib/leads/actions";
import {
  FOLLOW_UP_CHOICES, LEAD_VIEWS, isWaiting, leadName, leadSettings, leadView,
  sourceLabels, statusLabels, viewLabels, type Lead,
} from "@/lib/leads/model";
import "./leads.css";

const channelLabels: Record<string, string> = { instagram: "Instagram", whatsapp: "WhatsApp" };

function ago(iso: string, now: number) {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (minutes < 60) return `${minutes} min më parë`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} orë më parë`;
  return `${Math.round(hours / 24)} ditë më parë`;
}

export default async function LeadsPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const { user, access } = await requireEnabledModule(slug, "leads");
  const view = leadView(typeof (await searchParams).view === "string" ? ((await searchParams).view as string) : undefined);
  const db = createServiceSupabase();
  const [{ data: business }, { data: member }, { data: rows, error }] = await Promise.all([
    db.from("businesses").select("lead_settings").eq("id", access.business.id).maybeSingle(),
    db.from("business_users").select("role").eq("business_id", access.business.id).eq("user_id", user.id).maybeSingle(),
    db.from("leads")
      .select("id,status,source,interest,note,last_interest_at,status_changed_at,created_at,conversation_id,customer:customers(id,display_name,username,phone),conversation:conversations(channel,participant_display_name,participant_username)")
      .eq("business_id", access.business.id)
      .in("status", view === "won" ? ["won"] : view === "lost" ? ["lost"] : view === "waiting" ? ["new"] : ["new", "contacted"])
      .order("last_interest_at", { ascending: false })
      .limit(200),
  ]);
  if (error) throw new Error("Leads nuk u ngarkuan. Provo përsëri.");
  const settings = leadSettings(business?.lead_settings);
  const canConfigure = access.admin || member?.role === "owner";
  const now = Date.now();
  type Row = Omit<Lead, "channel" | "participant"> & {
    conversation: { channel: string; participant_display_name: string | null; participant_username: string | null } | null;
  };
  const leads = ((rows ?? []) as unknown as Row[])
    .map((row) => ({
      ...row, channel: row.conversation?.channel ?? null,
      participant: row.conversation?.participant_display_name
        || (row.conversation?.participant_username ? `@${row.conversation.participant_username}` : null),
    }))
    .filter((lead) => view !== "waiting" || isWaiting(lead, settings.followUpHours, now));

  return <>
    <PageHeading title="Leads" description="Klientët që treguan interes por ende nuk kanë blerë ose rezervuar. Kur porositin ose rezervojnë, kalojnë vetë te “U bënë klientë”." />
    {!settings.enabled && <p className="lead-paused" role="status">Krijimi automatik i leads është i fikur. Ndize te rregullat më poshtë.</p>}
    <nav className="customer-views" aria-label="Pamjet e leads">
      {LEAD_VIEWS.map((v) => (
        <Link key={v} href={`/b/${slug}/leads${v === "open" ? "" : `?view=${v}`}`} aria-current={v === view ? "page" : undefined}>{viewLabels[v]}</Link>
      ))}
    </nav>

    <section className="panel lead-list" aria-label={viewLabels[view]}>
      {leads.length === 0 ? (
        <p className="lead-empty">{view === "waiting"
          ? `Asnjë lead nuk pret më shumë se ${settings.followUpHours} orë.`
          : view === "open" ? "Ende nuk ka leads. Krijohen vetë kur një klient pyet për çmim, disponueshmëri ose kërkon të kontaktohet." : "Asnjë lead këtu."}</p>
      ) : (
        <ul>
          {leads.map((lead) => {
            const waiting = isWaiting(lead, settings.followUpHours, now);
            return (
              <li key={lead.id} className="lead-row">
                <div className="lead-main">
                  <div className="lead-title">
                    <strong>{leadName(lead)}</strong>
                    <span className={`lead-status lead-status-${lead.status}`}>{statusLabels[lead.status]}</span>
                    {waiting && <span className="lead-status lead-status-waiting">Pret përgjigje</span>}
                  </div>
                  {lead.interest && <p className="lead-interest">“{lead.interest}”</p>}
                  <p className="lead-meta">
                    {sourceLabels[lead.source]}{lead.channel && channelLabels[lead.channel] ? ` · ${channelLabels[lead.channel]}` : ""} · {ago(lead.last_interest_at, now)}
                  </p>
                </div>
                <div className="lead-side">
                  {lead.conversation_id && <Link className="btn btn-primary" href={`/b/${slug}/inbox/${lead.conversation_id}`}>Hap bisedën</Link>}
                  <LeadStatusButtons slug={slug} leadId={lead.id} status={lead.status} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>

    <details className="panel lead-settings">
      <summary>Rregullat e leads</summary>
      {canConfigure ? (
        <ActionForm action={saveLeadSettings.bind(null, slug)} className="lead-settings-form" successMessage="Rregullat u ruajtën.">
          <label className="settings-toggle">
            <span>Krijo leads automatikisht<small>Nga mesazhet e klientëve në Instagram dhe WhatsApp.</small></span>
            <input className="switch-input" type="checkbox" name="enabled" defaultChecked={settings.enabled} />
          </label>
          <fieldset className="lead-rules">
            <legend>Kur krijohet një lead</legend>
            <label className="settings-toggle"><span>Klienti pyet për çmimin<small>“Sa kushton…”, “çmimi”, “ofertë”.</small></span>
              <input className="switch-input" type="checkbox" name="price" defaultChecked={settings.price} /></label>
            <label className="settings-toggle"><span>Klienti pyet për disponueshmërinë<small>“A keni…”, “ka vend”, “në stok”.</small></span>
              <input className="switch-input" type="checkbox" name="availability" defaultChecked={settings.availability} /></label>
            <label className="settings-toggle"><span>Klienti kërkon të kontaktohet<small>Lë numrin ose emailin, ose shkruan “më telefononi”.</small></span>
              <input className="switch-input" type="checkbox" name="contact" defaultChecked={settings.contact} /></label>
          </fieldset>
          <label className="lead-field">
            <span className="form-label">Fjalë kyçe të tua</span>
            <textarea className="field" name="keywords" rows={2} maxLength={900} defaultValue={settings.keywords.join(", ")}
              placeholder="P.sh. porosi me shumicë, katalog, takim" />
            <small className="settings-hint">Të ndara me presje. Një mesazh që përmban njërën krijon lead.</small>
          </label>
          <label className="settings-toggle">
            <span>Shëno “Në kontakt” kur stafi përgjigjet<small>Përgjigja nga Inbox e kalon lead-in vetë.</small></span>
            <input className="switch-input" type="checkbox" name="autoContacted" defaultChecked={settings.autoContacted} />
          </label>
          <label className="lead-field lead-field-inline">
            <span className="form-label">Një lead “pret përgjigje” pas</span>
            <select className="field" name="followUpHours" defaultValue={String(settings.followUpHours)}>
              {FOLLOW_UP_CHOICES.map((h) => <option key={h} value={h}>{h} {h === 1 ? "ore" : "orësh"}</option>)}
            </select>
          </label>
          <p className="settings-hint">Instagram dhe WhatsApp lejojnë t’i shkruash lirisht klientit vetëm brenda 24 orëve nga mesazhi i tij.</p>
          <button className="btn btn-primary" type="submit">Ruaj rregullat</button>
        </ActionForm>
      ) : <p className="settings-hint">Rregullat i ndryshon pronari i biznesit.</p>}
    </details>
  </>;
}
