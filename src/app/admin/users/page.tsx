import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeading, StatusBadge, formatDate } from "@/components/dashboard/ui";
import { RecordBrowser } from "@/components/dashboard/record-browser";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { UserForm } from "./user-form";
import { loadPlatformUsage, type UserUsage } from "@/lib/admin/usage";
import { plans } from "@/lib/billing/service";

type UserRow = {
  id: string; name: string; email: string | null; created_at: string;
  last_sign_in_at: string | null; email_confirmed_at: string | null; banned: boolean; admin: boolean;
  businesses: { id: string; name: string; slug: string; role: string }[];
};
const actionLabels: Record<string, string> = { create: "Krijim llogarie", password: "Ndryshim fjalëkalimi", verify_email: "Verifikim manual i email-it", restore: "Rikthim llogarie" };
const statusLabels: Record<string, string> = { pending: "Pa konfirmim përfundimtar", completed: "U krye", failed: "Dështoi" };

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getSessionUser();
  if (!actor || !(await isPlatformAdmin(actor.id))) redirect("/auth/continue");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  const filter = typeof params.filter === "string" && ["verified", "unverified", "no-business", "admin"].includes(params.filter) ? params.filter : "";
  const business = typeof params.business === "string" && /^[0-9a-f-]{36}$/i.test(params.business) ? params.business : "";
  const page = Math.floor(Math.max(1, Math.min(1000000, Number(params.page) || 1)));
  const db = createServiceSupabase();
  const [result, options, usage] = await Promise.all([
    db.rpc("admin_list_users", { p_search: q, p_filter: filter, p_business: business || null, p_page: Math.floor(page) }),
    db.from("businesses").select("id,name").order("name"),
    // Messages and tokens this month, for the users who pay for their businesses.
    loadPlatformUsage().catch(() => null),
  ]);
  const usageByUser = new Map<string, UserUsage>((usage?.users ?? []).map((u) => [u.userId, u]));
  const num = (value: number) => value.toLocaleString("sq-AL");
  if (result.error || options.error) throw new Error("Nuk u ngarkuan përdoruesit. Kontrollo lidhjen dhe migrimin e administrimit të përdoruesve.");
  const { users, total } = result.data as { users: UserRow[]; total: number };
  const ids = users.map(u => u.id);
  const [history, deletionRows] = ids.length ? await Promise.all([
    db.from("platform_user_events").select("id,actor_id,target_id,action,status,created_at").in("target_id", ids).order("created_at", { ascending: false }).limit(250),
    db.from("account_deletions").select("user_id,status,purge_after").in("user_id", ids).in("status", ["scheduled", "purging"]),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  const deletions = new Map((deletionRows.data ?? []).map(d => [d.user_id, d as { status: string; purge_after: string }]));
  const actorIds = [...new Set((history.data ?? []).map(e => e.actor_id))];
  const profiles = actorIds.length ? await db.from("profiles").select("id,email").in("id", actorIds) : { data: [] };
  const actorEmails = new Map((profiles.data ?? []).map(p => [p.id, p.email]));
  return <>
    <PageHeading eyebrow="PLATFORMA" title="Përdoruesit" description="Menaxho llogaritë, verifikimin e email-it dhe aksesin në biznese." />
    <form className="panel grid gap-3 p-4 mb-4 sm:grid-cols-4" action="/admin/users">
      <label className="form-label">Kërko emër ose email<input className="field" name="q" defaultValue={q} maxLength={100} placeholder="Emër ose email…" /></label>
      <label className="form-label">Filtri<select className="field" name="filter" defaultValue={filter}><option value="">Të gjithë</option><option value="no-business">Pa biznes</option><option value="verified">Email i verifikuar</option><option value="unverified">Email i paverifikuar</option><option value="admin">Administratorë platforme</option></select></label>
      <label className="form-label">Biznesi<select className="field" name="business" defaultValue={business}><option value="">Të gjitha bizneset</option>{options.data?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <button className="btn btn-ghost self-end" type="submit">Kërko / filtro</button>
    </form>
    <RecordBrowser hideSearch serverPage={{ page, pageSize: 25, total, search: q, path: "/admin/users", filters: { filter, business } }} listTitle="Përdoruesit" placeholder="Kërko në rezultatet e kësaj faqeje…" columns={["Përdoruesi", "Bizneset", "Mesazhe / tokena (muaji)", "Hyrja e fundit"]}
      emptyTitle="Nuk u gjetën përdorues" emptyDescription="Ndrysho kërkimin ose krijo një llogari të re."
      createLabel="Krijo përdorues" createAsModal createForm={<UserForm action="create" businesses={options.data ?? []} />}
      records={users.map(u => ({ id: u.id, title: u.name, subtitle: u.email ?? "Pa email", cells: [
        u.admin ? "Administrator platforme" : u.businesses.map(b => b.name).join(", ") || "Pa biznes",
        usageByUser.get(u.id) ? `${num(usageByUser.get(u.id)!.messages)} / ${num(usageByUser.get(u.id)!.limit)} · ${num(usageByUser.get(u.id)!.tokens)} tokena` : usage ? "—" : "Nuk u ngarkua",
        formatDate(u.last_sign_in_at),
      ], detail: <>
        <div className="detail-header"><div><h2>{u.name}</h2><p>{u.email}</p></div></div>
        <div className="detail-block"><h3>Llogaria</h3><dl className="detail-fields"><div><dt>Statusi</dt><dd>{deletions.get(u.id) ? `Fshirje e kërkuar · fshihet përfundimisht më ${formatDate(deletions.get(u.id)!.purge_after)}` : u.banned ? "E pezulluar" : "E papezulluar"}</dd></div><div><dt>Email-i</dt><dd>{u.email_confirmed_at ? `Verifikuar më ${formatDate(u.email_confirmed_at)}` : "I paverifikuar"}</dd></div><div><dt>Aksesi</dt><dd>{u.admin ? "Administrator platforme" : "Përdorues"}</dd></div><div><dt>Regjistruar</dt><dd>{formatDate(u.created_at)}</dd></div><div><dt>Hyrja e fundit</dt><dd>{formatDate(u.last_sign_in_at)}</dd></div></dl><StatusBadge status={u.email_confirmed_at ? "connected" : "paused"} label={u.email_confirmed_at ? "Email i verifikuar" : "Email i paverifikuar"} /></div>
        <div className="detail-block"><h3>Konsumi këtë muaj</h3>{usageByUser.get(u.id) ? <dl className="detail-fields">
          <div><dt>Paketa</dt><dd>{plans[usageByUser.get(u.id)!.plan].name} · {num(usageByUser.get(u.id)!.limit)} mesazhe/muaj</dd></div>
          <div><dt>Mesazhe AI</dt><dd>{num(usageByUser.get(u.id)!.messages)} nga {num(usageByUser.get(u.id)!.limit)}</dd></div>
          <div><dt>Tokena</dt><dd>{num(usageByUser.get(u.id)!.tokens)} · {num(usageByUser.get(u.id)!.calls)} thirrje</dd></div>
          <div><dt>Biznese që paguan</dt><dd>{num(usageByUser.get(u.id)!.businesses)}</dd></div>
        </dl> : <p className="muted-copy">{usage ? "Ky përdorues nuk paguan për asnjë biznes." : "Statistikat nuk u ngarkuan."}</p>}<Link className="soft-link" href="/admin/usage">Të gjitha statistikat →</Link></div>
        <div className="detail-block"><h3>Bizneset dhe rolet</h3>{u.businesses.length ? u.businesses.map(b => <p key={b.id}><Link className="soft-link" href={`/b/${b.slug}`}>{b.name}</Link> · {b.role === "owner" ? "Pronar" : "Staf"}</p>) : <p className="muted-copy">Ky përdorues nuk është anëtar i asnjë biznesi.</p>}</div>
        {deletionRows.error && <div className="detail-block"><p role="alert">Gjendja e fshirjes nuk u ngarkua.</p></div>}
        {deletions.get(u.id)?.status === "scheduled" && <div className="detail-block"><h3>Rikthe llogarinë</h3><UserForm key={`restore-${u.id}`} action="restore" userId={u.id} /></div>}
        {deletions.get(u.id)?.status === "purging" && <div className="detail-block"><p className="muted-copy">Fshirja përfundimtare është në proces dhe nuk mund të anulohet.</p></div>}
        {u.email && !u.email_confirmed_at && <div className="detail-block"><h3>Verifikimi manual</h3><UserForm key={`verify-${u.id}`} action="verify_email" userId={u.id} /></div>}
        <div className="detail-block"><h3>Ndrysho fjalëkalimin</h3><UserForm key={`password-${u.id}`} action="password" userId={u.id} /></div>
        <div className="detail-block"><h3>Historia administrative</h3><p className="muted-copy">Veprimet më të fundit të regjistruara nga ky seksion.</p>{history.error ? <p role="alert">Historia nuk u ngarkua.</p> : (history.data ?? []).filter(e => e.target_id === u.id).length ? (history.data ?? []).filter(e => e.target_id === u.id).slice(0, 10).map(e => <p key={e.id}>{actionLabels[e.action]} · {statusLabels[e.status]}<br /><small>{formatDate(e.created_at)} · {actorEmails.get(e.actor_id) ?? e.actor_id}</small></p>) : <p className="muted-copy">Nuk ka veprime të regjistruara.</p>}</div>
      </> }))} />
  </>;
}
