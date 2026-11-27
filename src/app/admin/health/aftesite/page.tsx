import { redirect } from "next/navigation";
import { PageHeading } from "@/components/dashboard/ui";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import {
  averagePercent, businessCapabilities, capabilityReportUpdated, currentState, customerCapabilities, mainProblems,
  manualByDesign, modulePercent, statusCounts, type CapabilityModule, type CapabilityStatus,
} from "@/lib/agent-report/capabilities";
import { HealthTabs } from "../tabs";
import s from "../health.module.css";
import c from "./capabilities.module.css";

export const metadata = { title: "Aftësitë e Agjentit | Agjenti.app" };

const statusLabel: Record<CapabilityStatus, string> = { po: "Po", pjes: "Pjesërisht", jo: "Jo" };
const tier = (p: number) => p >= 75 ? c.hi : p >= 50 ? c.mid : c.lo;
const updated = new Intl.DateTimeFormat("sq-AL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Tirane" })
  .format(new Date(`${capabilityReportUpdated}T12:00:00Z`));

/** One module: its score as a bar, its capabilities inside, strongest modules first. */
function Modules({ modules }: { modules: CapabilityModule[] }) {
  return <div className={c.modules}>
    {[...modules].sort((a, b) => modulePercent(b) - modulePercent(a)).map(m => {
      const p = modulePercent(m), n = statusCounts(m);
      return <details key={m.name} className={c.module}>
        <summary>
          <strong>{m.name}</strong>
          <span className={c.bar} aria-hidden="true"><i className={tier(p)} style={{ width: `${p}%` }} /></span>
          <span className={c.pct}>{p}%</span>
          <small>{n.po} po · {n.pjes} pjesërisht · {n.jo} jo</small>
        </summary>
        <ul className={c.caps}>
          {m.items.map(([status, text]) => <li key={text}><span className={`${s.status} ${s[status]}`}>{statusLabel[status]}</span><span>{text}</span></li>)}
        </ul>
      </details>;
    })}
  </div>;
}

/**
 * Platform Admin: what the customer agent and the Assistant can do, module by module, rated from the code.
 * The ratings live in src/lib/agent-report/capabilities.ts and change with the code that changes a capability.
 */
export default async function CapabilitiesPage() {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/auth/continue");
  const tiles = [
    { value: averagePercent(customerCapabilities), label: "Agjenti i klientit", hint: `Mesatarja e ${customerCapabilities.length} moduleve që i përkasin klientit.` },
    { value: averagePercent(businessCapabilities), label: "Agjenti i biznesit", hint: `Mesatarja e ${businessCapabilities.length} moduleve që i shërbejnë pronarit.` },
  ];

  return <div className={s.page}>
    <PageHeading eyebrow="PLATFORMA" title="Shëndeti i Agjentit"
      description={`Çfarë di të bëjë agjenti i klientit në Instagram dhe WhatsApp, dhe Asistenti për pronarin, në çdo modul. Vlerësuar nga leximi i kodit, përditësuar më ${updated}.`} />
    <HealthTabs current="aftesite" />

    <div className={c.tiles}>
      {tiles.map(t => <section key={t.label} className="panel section-pad">
        <span className={s.heroValue}>{t.value}%</span>
        <h2 className={c.tileLabel}>{t.label}</h2>
        <p className="muted-copy">{t.hint}</p>
      </section>)}
    </div>

    <section className="panel section-pad">
      <h2>Gjendja reale sot, ndryshe nga aftësitë</h2>
      <ul className={c.list}>{currentState.map(item => <li key={item}>{item}</li>)}</ul>
    </section>

    <div className={c.legend} aria-label="Si lexohen shenjat">
      <span><span className={`${s.status} ${s.po}`}>Po</span>funksionon (1)</span>
      <span><span className={`${s.status} ${s.pjes}`}>Pjesërisht</span>vetëm me konfigurim të caktuar ose pjesërisht (0.5)</span>
      <span><span className={`${s.status} ${s.jo}`}>Jo</span>nuk ekziston (0)</span>
    </div>

    <section className="panel section-pad" aria-labelledby="klienti">
      <h2 id="klienti">Agjenti i klientit (Instagram, WhatsApp)</h2>
      <p className="muted-copy">Raportet, Aktiviteti, Cilësimet, Agjenti, Workflow dhe Burimet nuk i përkasin klientit, prandaj nuk janë këtu. Hap një modul për të parë aftësitë.</p>
      <Modules modules={customerCapabilities} />
    </section>

    <section className="panel section-pad" aria-labelledby="biznesi">
      <h2 id="biznesi">Agjenti i biznesit (Asistenti)</h2>
      <p className="muted-copy">Burimi: regjistri <code>src/lib/actions/operations/manual-surfaces.ts</code>, që përcakton për çdo veprim të panelit nëse Asistenti e kryen ose pse jo. Veprimet që mbeten me qëllim vetëm me dorë nuk llogariten këtu; janë më poshtë.</p>
      <Modules modules={businessCapabilities} />
    </section>

    <section className="panel section-pad" aria-labelledby="me-dore">
      <h2 id="me-dore">Me qëllim vetëm me dorë</h2>
      <p className="muted-copy">Vendime të produktit, jo mangësi: nuk llogariten në përqindje dhe nuk i shtohen Asistentit.</p>
      <ul className={c.list}>{manualByDesign.map(item => <li key={item}>{item}</li>)}</ul>
    </section>

    <section className="panel section-pad" aria-labelledby="problemet">
      <h2 id="problemet">Problemet kryesore</h2>
      <ol className={c.problems}>{mainProblems.map(p => <li key={p.title}><strong>{p.title}</strong><span className="muted-copy">{p.detail}</span></li>)}</ol>
    </section>

    <section className="panel section-pad" aria-labelledby="metoda">
      <h2 id="metoda">Metoda dhe kufizimet</h2>
      <div className={c.method}>
        <p><strong>Çfarë mat kjo faqe.</strong> Për çdo modul janë listuar aftësitë që pritet të ketë agjenti, dhe secila u vlerësua duke lexuar kodin: Po = 1, Pjesërisht = 0.5, Jo = 0. Përqindja e modulit është mesatarja e tyre; mesatarja e agjentit është mesatarja e moduleve.</p>
        <p><strong>Çfarë nuk mat.</strong> Kjo është masë e asaj që Agjenti di të bëjë, jo e asaj që arrin në bisedat reale. Si shkon realisht çdo aftësi e tregon skeda Shëndeti, nga regjistri i hyrjeve dhe daljeve.</p>
        <p><strong>Matja nga prodhimi.</strong> Query-a vetëm-lexim <code>docs/aftesite-e-agjentit/matja-e-proceseve.sql</code> llogarit për 30 ditët e fundit përqindjen e përgjigjeve dhe përfundimin e porosive, rezervimeve, statusit dhe kalimit te stafi.</p>
      </div>
    </section>
  </div>;
}
