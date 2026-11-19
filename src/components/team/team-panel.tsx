"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeTeamRole, inviteTeamMember, removeTeamMember, revokeTeamInvitation } from "@/lib/team/actions";
import type { TeamInvitation, TeamMember } from "@/lib/team/service";

const roles = { owner: "Pronar", staff: "Staf" } as const;
const roleHints = { owner: "Sheh dhe ndryshon gjithçka: cilësimet, pagesat dhe ekipin.", staff: "Punon me bisedat, porositë, produktet dhe klientët; nuk ndryshon pagesat dhe ekipin." };
const date = (value: string) => new Intl.DateTimeFormat("sq-AL", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Tirane" }).format(new Date(value));

/** Cilësimet → Ekipi: who works in this business, their role, and the invitations waiting. */
export function TeamPanel({ slug, members, invitations, owner }: { slug: string; members: TeamMember[]; invitations: TeamInvitation[]; owner: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "staff">("staff");
  const [message, setMessage] = useState<{ error?: string; success?: string; link?: string | null }>({});
  const [pending, start] = useTransition();
  const act = (work: () => Promise<{ error?: string; success?: string; link?: string | null }>) => start(async () => {
    setMessage({}); const result = await work(); setMessage(result); if (!result.error) router.refresh();
  });
  const copy = (link: string) => { void navigator.clipboard?.writeText(link); setMessage({ success: "Lidhja u kopjua." }); };
  return <div className="grid gap-4">
    <section className="panel section-pad grid gap-3" aria-labelledby="team-members">
      <h2 id="team-members">Anëtarët · {members.length}</h2>
      <ul className="grid gap-2">{members.map(m => <li key={m.userId} style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
        <span><strong>{m.name || m.email || "Anëtar"}</strong>{m.you && <small className="muted-copy"> · ti</small>}<br /><small className="muted-copy">{m.email ?? ""}{m.email ? " · " : ""}që nga {date(m.since)}</small></span>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {owner && !m.you ? <>
            <select className="field" aria-label={`Roli i ${m.email ?? "anëtarit"}`} value={m.role} disabled={pending} onChange={e => act(() => changeTeamRole(slug, m.userId, e.target.value))}>
              {Object.entries(roles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => { if (window.confirm(`Ta heqim ${m.email ?? "këtë anëtar"} nga biznesi?`)) act(() => removeTeamMember(slug, m.userId)); }}>Hiq</button>
          </> : <span className="muted-copy">{roles[m.role]}</span>}
        </span>
      </li>)}</ul>
    </section>

    {owner && <section className="panel section-pad grid gap-3" aria-labelledby="team-invite">
      <h2 id="team-invite">Fto dikë</h2>
      <p className="muted-copy">Krijohet një lidhje që e dërgon vetë (WhatsApp, email…). E pranon vetëm personi me këtë email, pasi të hyjë ose të regjistrohet. Vlen 7 ditë.</p>
      <form className="grid gap-2" onSubmit={e => { e.preventDefault(); act(async () => { const r = await inviteTeamMember(slug, email, role); if (!r.error) setEmail(""); return r; }); }}>
        <input className="field" type="email" required placeholder="emri@shembull.com" value={email} onChange={e => setEmail(e.target.value)} aria-label="Emaili" />
        {(Object.keys(roles) as ("owner" | "staff")[]).map(value => <label key={value} className="form-label" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <input type="radio" name="role" checked={role === value} onChange={() => setRole(value)} />
          <span><strong>{roles[value]}</strong><br /><small className="muted-copy">{roleHints[value]}</small></span>
        </label>)}
        <div><button className="btn btn-primary" type="submit" disabled={pending || !email.trim()}>{pending ? "Duke krijuar…" : "Krijo ftesën"}</button></div>
      </form>
    </section>}

    {message.error && <p className="form-feedback form-feedback-error" role="alert">{message.error}</p>}
    {message.success && <p className="form-feedback" role="status">{message.success}{message.link && <> <button type="button" className="btn btn-ghost" onClick={() => copy(message.link!)}>Kopjo lidhjen</button></>}</p>}

    {invitations.length > 0 && <section className="panel section-pad grid gap-3" aria-labelledby="team-invitations">
      <h2 id="team-invitations">Ftesat në pritje · {invitations.length}</h2>
      <ul className="grid gap-2">{invitations.map(i => <li key={i.id} style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        <span>{i.email}<br /><small className="muted-copy">{roles[i.role]} · skadon më {date(i.expiresAt)}</small></span>
        {owner && <span style={{ display: "flex", gap: 8 }}>
          {i.link && <button type="button" className="btn btn-ghost" onClick={() => copy(i.link!)}>Kopjo lidhjen</button>}
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => act(() => revokeTeamInvitation(slug, i.id))}>Anulo</button>
        </span>}
      </li>)}</ul>
    </section>}
  </div>;
}
