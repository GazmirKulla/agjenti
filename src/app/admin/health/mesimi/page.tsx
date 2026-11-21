import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { PageHeading } from "@/components/dashboard/ui";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { HealthTabs } from "../tabs";
import s from "../health.module.css";
import m from "./learning.module.css";

export const metadata = { title: "Agjenti që mëson vetë | Agjenti.app" };

type Status = "po" | "pjes" | "jo";
const statusLabel: Record<Status, string> = { po: "Po", pjes: "Pjesërisht", jo: "Jo" };
const Status = ({ status, label }: { status: Status; label?: string }) =>
  <span className={`${s.status} ${s[status]}`}>{label ?? statusLabel[status]}</span>;

function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children?: ReactNode }) {
  return <section className={`panel section-pad ${m.section}`} aria-labelledby={id}>
    <h2 id={id}>{title}</h2>
    {intro && <p className="muted-copy">{intro}</p>}
    {children}
  </section>;
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return <div className="table-scroll">
    <table className={`data-table ${m.table}`}>
      <thead><tr>{head.map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

function Lanes({ lanes }: { lanes: { title: ReactNode; tone: "success" | "warning" | "accent"; items: ReactNode[] }[] }) {
  return <div className={m.lanes}>
    {lanes.map((lane, i) => <div key={i} className={`${m.lane} ${m[lane.tone]}`}>
      <h3>{lane.title}</h3>
      <ul>{lane.items.map((item, j) => <li key={j}>{item}</li>)}</ul>
    </div>)}
  </div>;
}

const Note = ({ title, tone = "accent", children }: { title: string; tone?: "accent" | "warning"; children: ReactNode }) =>
  <div className={`${m.note} ${m[tone]}`} role="note"><strong>{title}</strong><p>{children}</p></div>;

const today: [string, ReactNode, Status, ReactNode][] = [
  ["Asistenti shkruan", <><code>knowledge.save</code>, <code>agent.communication</code> (draft → publikim, me versione), <code>training.save</code>; para/pas, leje, konfirmim (<code>actions/operations</code>)</>, "po", "Një rregull i qartë se ku shkon ajo që thotë pronari"],
  ["Ndarja fakt / udhëzim", <>Faktet nxirren nga udhëzimet dhe kalojnë te Njohuritë (<code>agents/instruction-facts.ts</code>)</>, "pjes", "E njëjta ndarje për mesazhin e pronarit te Asistenti"],
  ["Burimi i njohurisë", <><code>knowledge_entries.source</code> me llojin, citimin dhe datën; lloji <code>assistant</code> ekziston (<code>knowledge/context.ts</code>)</>, "po", "—"],
  ["Bisedat e Agjentit si të dhëna", <>Importi nga Bisedat i lexon me folësin e saktë (klient, pronar, agjent); <code>analyzed_at</code> shënon çfarë u analizua</>, "pjes", "Nis vetëm kur pronari e nis"],
  ["Analiza me evidencë", <>Evidencë nga biseda, besueshmëri, rrezik; klienti vetëm → boshllëk; fjalët e Agjentit më pak të sigurta; çmimet e vjetra presin pronarin (<code>analysis-model.ts</code>, <code>match.ts</code>)</>, "po", "Burimet e duhura për mësimin periodik"],
  ["Sinjalet e dështimit", <>Ngjarjet e aftësive me <code>conversation_id</code>, rezultat (sukses, dështim, kalim te stafi) dhe arsye; klienti i pakënaqur më vete</>, "po", "Lidhja me analizën"],
  ["Përdorimi gjatë bisedës", <>Deri në 1000 njohuri, 12 të zgjedhura për mesazh; 16 rregulla dhe 6 shembuj nga memoria (<code>business-grounding.ts</code>, <code>training/model.ts</code>)</>, "po", "Mirëmbajtja: dyfishimet dhe kundërthëniet ulin cilësinë"],
  ["Kthimi mbrapsht", <>Udhëzimet kanë versione; njohuritë jo; operacionet ruajnë gjendjen <code>before</code></>, "jo", "Kthim mbrapsht për njohuritë dhe mësimet"],
];

const destinations: [string, string, string][] = [
  ["Një fakt për biznesin", "orari, dërgesa, kthimet, garancia", "Njohuri, me burim dhe citim"],
  ["Një rregull sjelljeje", "“mos premto orë”, “kur është i nervozuar kaloje te stafi”", "Udhëzim (draft → publikim) ose cilësim te “Çfarë bën Agjenti”"],
  ["Si të përgjigjet", "“kështu do ta thoja unë: …”", "Mësim: stil ose shembull"],
  ["Të dhëna të ofertës", "çmimi, stoku, një produkt i ri", "Produktet ose Shërbimet, me operacionet ekzistuese"],
  ["Diçka të paqartë", "“bëje më të mirë agjentin”", "Asgjë; Asistenti pyet çfarë konkretisht"],
];

const cycle: [string, ReactNode][] = [
  ["Zgjedh", "Bisedat e reja me një nga tri burimet. Kur s'ka të reja, s'ka analizë."],
  ["Analizon", <>Me motorin ekzistues të trajnimit dhe <code>checkpoint</code>-in e tij, pa motor të dytë.</>],
  ["Krahason", "Me njohuritë, udhëzimet, mësimet dhe produktet: e re, e njëjtë, ndryshim apo konflikt."],
  ["Vendos", "Rregulli në kod: krijohet vetë, pret konfirmim, ose bëhet pyetje."],
  ["Raporton", "Asistenti i thotë pronarit çfarë mësoi Agjenti dhe çfarë pret vendimin e tij."],
];

const risks: [string, ReactNode, ReactNode][] = [
  ["Agjenti mëson gabimet e veta", <>Fjalët e Agjentit ulen në “medium”, por mund të bëhen njohuri (<code>analysis-model.ts</code>)</>, "Fjalët e Agjentit kurrë fakt; vetëm evidencë për boshllëk"],
  ["Mbishkrim i tekstit të pronarit", <>Zbatimi i sugjerimit e mbishkruan njohurinë me <code>knowledge.save</code>; mbrojtja ekziston vetëm te rifreskimi i burimeve (<code>apply.ts</code>)</>, "Vetë vetëm krijim; çdo ndryshim pret konfirmimin"],
  ["Pa kthim mbrapsht", "Njohuritë nuk kanë versione", <>Kthim mbrapsht nga gjendja <code>before</code> e operacionit, ose versione të njohurive</>],
  ["Sugjerimet zhduken", <>Çdo analizë e re i shënon “superseded” të gjitha sugjerimet e hapura (<code>storeSuggestions</code>)</>, "Zëvendësohet vetëm sugjerimi për të njëjtin objekt ose përmbajtje"],
  ["Puna në sfond pa përdorues", <>Zbatimi kërkon përdorues për lejet; nisja kërkon <code>p_user</code>, një analizë njëherësh, 10 në ditë</>, "Pëlqimi i pronarit ruhet kur ndez “Mëso vetë”; shkrimet shënohen “Agjenti, mësim automatik”; lejet kontrollohen sërish; nuk bllokon importin me dorë"],
  ["Stili ndryshon çdo natë", <>Stili publikohet menjëherë dhe zëvendëson bllokun e tij (<code>apply.ts</code>)</>, "Vetëm ndryshim i qëndrueshëm, maksimumi një herë në javë, version që rikthehet"],
  ["Fakt i rremë nga një bisedë e veçantë", "Një bisedë mjafton për një sugjerim", "Evidencë nga disa biseda; çmimet, orari, politikat gjithmonë me konfirmim"],
  ["Klienti manipulon Agjentin", <>Mbrojtja është regex frazash (<code>INSTRUCTION_ATTEMPT</code>), e ndaluar nga AGENTS.md</>, "Rregull strukturor: teksti i klientit kurrë udhëzim apo përgjigje shembull"],
  ["Kostoja", "Çelësi OpenAI i platformës; përdorimi i atribuohet biznesit (“tokena këtë muaj”)", "Vetëm bisedat e reja me sinjal; asnjë analizë pa të reja; kufijtë ekzistues të mësimit"],
  ["Asistenti e vendos gabim tekstin e pronarit", "Sot modeli zgjedh operacionin pa rregull të qartë", "Para/pas me citimin; pyetje kur është e paqartë; teste me tekste njerëzore, gjuhë të ndryshme, mohime, kërkesa të përziera"],
];

const phases: { label: string; title: string; area: string; changes: ReactNode[]; accept?: ReactNode[] }[] = [
  { label: "Faza 0", title: "Mbrojtjet", area: "motori", changes: [
    "Kthim mbrapsht për njohuritë dhe mësimet (rreziku 3).",
    "Mbrojtja e tekstit të pronarit në çdo rrugë shkrimi, jo vetëm te burimet (rreziku 2).",
    "Sugjerimet zëvendësohen vetëm për të njëjtin objekt (rreziku 4).",
    "Aktori dhe pëlqimi për punën në sfond (rreziku 5).",
    "Rregulli strukturor për tekstin e klientit në vend të regex-eve (rreziku 8).",
  ], accept: ["Teste për secilin rrezik: mbishkrim, kthim mbrapsht, analiza të njëpasnjëshme, tekst klienti që jep urdhra në gjuhë të ndryshme."] },
  { label: "Faza 1", title: "“Mëso Agjentin” te Asistenti", area: "Asistenti", changes: [
    "Hap i strukturuar: vendi, teksti i qartë, citimi origjinal, objektet që prek.",
    <>Ripërdor ndarjen fakt/udhëzim të <code>instruction-facts.ts</code> dhe operacionet ekzistuese.</>,
    <>Burimi ruhet me <code>source.kind = &quot;assistant&quot;</code>, citimin dhe datën.</>,
  ], accept: ["Kërkesa e paqartë sjell pyetje, jo ruajtje; asgjë nuk mbishkruhet pa konfirmim të objektit të saktë."] },
  { label: "Faza 2", title: "Menyja me dy hyrje dhe “Çfarë di Agjenti”", area: "UI", changes: [
    <>Menyja: “Çfarë bën Agjenti” dhe “Provo agjentin” (<code>workspace.ts</code>).</>,
    "“Çfarë di Agjenti” me numra realë dhe “Mëso diçka Agjentit”, që hap Asistentin.",
    "Faqet e vjetra mbeten të hapshme nga ky seksion dhe nga kërkimi.",
  ] },
  { label: "Faza 3", title: "Mësimi periodik nga tri burimet", area: "motori", changes: [
    "Puna e planifikuar nis analizën për bisedat e reja me sinjal, për bizneset me “Mëso vetë” të ndezur.",
    <>I njëjti motor, <code>checkpoint</code> dhe kufij; asnjë analizë pa të reja.</>,
    "Rregulli i zbatimit: vetë vetëm krijim i ri pa konflikt; të tjerat presin.",
  ], accept: [
    "Një bisedë analizohet një herë; një natë e dështuar vazhdon pa dyfishim.",
    "Fjalët e Agjentit nuk bëhen kurrë njohuri; asnjë çmim apo politikë pa konfirmim.",
  ] },
  { label: "Faza 4", title: "Asistenti raporton, pyet dhe mirëmban", area: "Asistenti + motori", changes: [
    "“Agjenti mësoi 3 gjëra; 1 pret ty”: konfirmimi, refuzimi dhe kthimi mbrapsht në chat, me referencë te gjetja e saktë.",
    "Boshllëqet bëhen pyetje të grupuara sipas temës.",
    "Mirëmbajtja: bashkimi i dyfishimeve dhe kundërthëniet si pyetje.",
  ] },
  { label: "Faza 5", title: "Gjurmimi dhe raporti", area: "në çdo fazë", changes: [
    <>Aftësitë e reja regjistrohen te <code>src/lib/tracking/capabilities.ts</code>: vendi i zgjedhur, i ruajtur, i refuzuar, krijuar vetë, kthyer mbrapsht.</>,
    "Shëndeti i Agjentit tregon sa mëson Agjenti dhe sa herë pronari e korrigjon.",
    "Raporti “Aftësitë e Agjentit” përditësohet në të njëjtin ndryshim.",
  ] },
];

const decisions: [string, ReactNode][] = [
  ["Faqet Udhëzimet, Njohuritë, Memoria", "Propozimi: jashtë menysë, por të hapshme nga “Çfarë di Agjenti” (rregulli i aksesit manual në AGENTS.md mbetet)."],
  ["Çfarë krijon Agjenti vetë?", "Propozimi: vetëm njohuri të reja pa konflikt, shembuj dhe stili javor. Alternativa: asgjë pa konfirmim."],
  ["Kthimi mbrapsht i njohurive", <>Propozimi: versione të njohurive (si te udhëzimet). Alternativa më e lehtë: nga gjendja <code>before</code> e operacionit, vetëm për ndryshimin e fundit.</>],
  ["Sa shpesh?", "Propozimi: bisedat me sinjal çdo natë, stili çdo javë, burimet çdo javë si sot."],
  ["A ka biznesi zgjedhjen?", "Propozimi: “Mëso vetë / Pyet mua për çdo gjë” te “Çfarë bën Agjenti”; pëlqimi ruhet me pronarin që e ndez."],
];

/**
 * Platform Admin: the plan for an agent that learns by itself (version 3, 20 November 2026, from reading the code).
 * A written plan, not live data: change it here when the plan changes or a phase ships.
 */
export default async function LearningPlanPage() {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/auth/continue");

  return <div className={s.page}>
    <PageHeading eyebrow="PLATFORMA" title="Shëndeti i Agjentit"
      description="Plan përmirësimi, versioni 3, 20 nëntor 2026, pas leximit të kodit. Asgjë nga ky plan nuk është ndërtuar ende." />
    <HealthTabs current="mesimi" />

    <section className={`panel section-pad ${m.section}`}>
      <h2 className={m.title}>Agjenti që mëson vetë</h2>
      <p className="muted-copy">Udhëzimet, njohuritë dhe memoria punojnë në sfond. Pronari flet vetëm me Asistentin: i thotë çfarë do që Agjenti të dijë ose të bëjë, dhe Asistenti e vendos në vendin e duhur, me fjalë të qarta dhe me kontekstin e pronarit. Agjenti mëson edhe vetë, periodikisht, nga bisedat që kryen, brenda mbrojtjeve që e pengojnë të mësojë gabim.</p>
      <Note title="Përfundimi nga kodi">E realizueshme pa motor të ri: shkrimi në njohuri, udhëzime dhe memorie, analiza e bisedave me evidencë dhe sinjalet e dështimit ekzistojnë. Mungojnë katër lidhje (hapi “Mëso Agjentin”, analiza periodike, burimet e mësimit, mirëmbajtja e njohurive) dhe pesë mbrojtje që duhen para çdo automatizimi.</Note>
    </section>

    <Section id="ekziston" title="Çfarë ekziston dhe çfarë mungon">
      <Table head={["Pjesa", "Sot në kod", "Gjendja", "Çfarë mungon"]} rows={today.map(([part, code, status, missing]) => [<strong key="p">{part}</strong>, code, <Status key="s" status={status} />, missing])} />
    </Section>

    <Section id="asistenti" title="Pronari mëson Agjentin përmes Asistentit"
      intro="Burimi më i besueshëm i mësimit, sepse pronari e konfirmon. Pronari shkruan si flet; Asistenti kupton çfarë do, zgjedh vendin, e shkruan qartë, ruan fjalët origjinale si burim dhe tregon para/pas.">
      <div className={m.chat}>
        <div className={`${m.msg} ${m.owner}`}><span>Pronari</span>“kur na pyesin per dergesen thuaju qe ne tirane vjen neser, rrethet 2-3 dite, edhe mos premto ore se nuk e dime”</div>
        <div className={`${m.msg} ${m.assistant}`}><span>Asistenti</span>
          <p>Do ta ruaj në dy vende:</p>
          <div className={m.card}><b>Njohuri · Dërgesa</b>Tiranë: të nesërmen. Rrethet: 2–3 ditë pune.<small>Burimi: ti, nëpërmjet Asistentit, 20 nën · “kur na pyesin per dergesen…”</small></div>
          <div className={m.card}><b>Udhëzim · Afatet</b>Mos premto orë të sakta dërgese.<small>Draft; publikohet kur e konfirmon</small></div>
          <p>Njohuria ekzistuese “Dërgesa: 1–2 ditë” bie ndesh me këtë. Ta zëvendësoj?</p>
        </div>
        <div className={`${m.msg} ${m.owner}`}><span>Pronari</span>“po”</div>
      </div>
      <Table head={["Kur pronari jep…", "Shembull", "Ruhet si"]} rows={destinations.map(([what, example, where]) => [<strong key="w">{what}</strong>, example, where])} />
      <p className="muted-copy">Zgjedhja e vendit bëhet nga modeli me rezultat të strukturuar (vendi, teksti i ri, citimi, objekti që prek). Serveri kontrollon skemën, lejet dhe konfliktet; asgjë nuk ruhet pa konfirmimin e objektit të saktë. Pa lista frazash.</p>
    </Section>

    <Section id="menyja" title="Menyja: nga gjashtë hyrje në dy">
      <div className={m.menus}>
        <div className={m.menu}>
          <h3>Sot <small>6 hyrje</small></h3>
          <ul>{["Udhëzimet", "Çfarë bën Agjenti", "Njohuritë", "Trajno nga bisedat", "Memoria", "Provo agjentin"].map(i => <li key={i}>{i}</li>)}</ul>
        </div>
        <div className={m.menu}>
          <h3>Synimi <small>2 hyrje</small></h3>
          <ul>
            <li><strong>Çfarë bën Agjenti</strong><span>Aftësitë dhe cilësimet, si sot</span></li>
            <li className={m.nested}><strong>Çfarë di Agjenti</strong><span>Përmbledhje: “42 njohuri · 3 burime · 7 mësime · mësoi 3 gjëra sot”</span></li>
            <li><strong>Provo agjentin</strong><span>Si sot</span></li>
            <li><strong>Asistenti AI</strong><span>Vendi ku pronari shton, ndryshon, konfirmon dhe kthen mbrapsht</span></li>
          </ul>
        </div>
      </div>
      <Note title="Rregulli i aksesit manual" tone="warning">AGENTS.md thotë: “Ruaj aksesin manual; mos detyro përdorimin e chat-it.” Faqet Udhëzimet, Njohuritë dhe Memoria dalin nga menyja, por mbeten të hapshme nga “Çfarë di Agjenti” dhe nga kërkimi. Për t&apos;i hequr plotësisht, rregulli duhet ndryshuar.</Note>
    </Section>

    <Section id="burimet" title="Nga çfarë mëson Agjenti vetë"
      intro="Përgjigjet e Agjentit dalin nga njohuritë që ai ka tashmë, prandaj nuk sjellin asgjë të re. Mësimi i vërtetë vjen nga tri burime.">
      <Lanes lanes={[
        { title: "Pyetjet pa përgjigje", tone: "accent", items: ["Klientët pyetën dhe Agjenti nuk e dinte", "Bëhen pyetje për pronarin, të grupuara sipas temës", "Përgjigja kalon nga “Mëso Agjentin”"] },
        { title: "Pronari pasi e merr bisedën", tone: "success", items: ["Përgjigjet e pronarit pas kalimit te stafi", "Fakte të reja dhe korrigjime", "Shembuj për stilin"] },
        { title: "Bisedat me dështim", tone: "warning", items: ["Kalim te stafi, klient i pakënaqur, proces i bllokuar", "Zgjidhen nga ngjarjet e aftësive, jo të gjitha bisedat", "Tregojnë ku i mungon diçka Agjentit"] },
      ]} />
      <p className="muted-copy"><strong>Fjalët e Agjentit nuk bëhen kurrë fakt.</strong> Shërbejnë vetëm si evidencë se diçka mungoi.</p>
    </Section>

    <Section id="cikli" title="Cikli periodik">
      <ol className={m.cycle}>{cycle.map(([name, text]) => <li key={name}><strong>{name}</strong><p>{text}</p></li>)}</ol>
    </Section>

    <Section id="rregulli" title="Rregulli i zbatimit" intro="Vlen për atë që Agjenti mëson vetë. Ajo që pronari i thotë Asistentit konfirmohet gjithmonë para se të ruhet.">
      <Lanes lanes={[
        { title: <><Status status="po" label="Vetë" /> vetëm krijim i ri</>, tone: "success", items: ["Njohuri e re pa konflikt, nga pronari, me evidencë nga disa biseda", "Shembuj nga përgjigjet e pronarit", "Stili: vetëm kur ndryshimi është i qëndrueshëm, maksimumi një herë në javë, me version që rikthehet", "Kurrë ndryshim i diçkaje ekzistuese"] },
        { title: <><Status status="pjes" label="Pyet" /> pret konfirmimin</>, tone: "warning", items: ["Çdo ndryshim i një njohurie, udhëzimi apo mësimi ekzistues", "Çmime, zbritje, pagesa, produkte, shërbime", "Orari, adresa, politikat", <>Çdo konflikt, çdo gjetje <code>important</code> ose me besueshmëri jo të lartë</>] },
        { title: <><Status status="po" label="Pyetje" /> boshllëqet</>, tone: "accent", items: ["“Klientët pyesin për X dhe Agjenti nuk e dinte. Si përgjigjem?”", "Një pyetje për temë, jo për çdo bisedë"] },
      ]} />
    </Section>

    <Section id="mirembajtja" title="Mirëmbajtja e njohurive"
      intro="Agjenti zgjedh vetëm 12 njohuri për çdo mesazh nga deri në 1000. Kur njohuritë shtohen vetë, dyfishimet dhe kundërthëniet e ulin cilësinë e përgjigjeve. Periodikisht: njohuritë e ngjashme propozohen për bashkim, kundërthëniet bëhen pyetje për pronarin, njohuritë që nuk përdoren më shënohen. Asgjë nuk fshihet pa konfirmim." />

    <Section id="rreziqet" title="Rreziqet dhe parandalimi" intro="Secili rrezik u gjet në kodin aktual, jo si hipotezë.">
      <Table head={["#", "Rreziku", "Ku në kod", "Parandalimi"]} rows={risks.map(([risk, where, prevention], i) => [i + 1, <strong key="r">{risk}</strong>, where, prevention])} />
      <Note title="Heuristika gjuhësore që mbeten në këtë rrjedhë" tone="warning"><code>INSTRUCTION_ATTEMPT</code> dhe <code>STYLE_WORDS</code> (regex), <code>factual = /\d/</code> te rreziku i njohurive, <code>nameKey</code>/<code>similarity</code> (përputhje emrash me rrënjë fjalësh shqip, që nuk punojnë në gjuhë të tjera). Zëvendësohen kur të preket kjo rrjedhë. <code>messageUnderstanding</code> te Agjenti i klientit nuk është verifikuar.</Note>
    </Section>

    <Section id="fazat" title="Fazat" intro="Faza 0 vjen para çdo automatizimi. Secila fazë del më vete dhe provohet para se të nisë tjetra.">
      <div className={m.phases}>
        {phases.map((phase, i) => <details key={phase.label} className={m.phase} open={i === 0}>
          <summary><span className={m.phaseLabel}>{phase.label}</span><strong>{phase.title}</strong><small>{phase.area}</small></summary>
          <div className={m.phaseBody}>
            <div><h4>Çfarë ndryshon</h4><ul>{phase.changes.map((c, j) => <li key={j}>{c}</li>)}</ul></div>
            {phase.accept && <div><h4>Kriteret e pranimit</h4><ul>{phase.accept.map((c, j) => <li key={j}>{c}</li>)}</ul></div>}
          </div>
        </details>)}
      </div>
    </Section>

    <Section id="kufijte" title="Çfarë ruhet dhe çfarë nuk bëjmë">
      <div className={m.menus}>
        <div className={m.menu}><h3>Ruhet</h3><ul>{["Operacionet e Asistentit, me para/pas dhe konfirmim", "Burimi, citimi dhe data e çdo njohurie", "Importi i bisedave të vjetra në onboarding", "Fshehja e emrave dhe kontakteve para se bisedat t'i dërgohen AI-së", "Rifreskimi javor i burimeve"].map(i => <li key={i}>{i}</li>)}</ul></div>
        <div className={m.menu}><h3>Nuk bëjmë</h3><ul>{["Motor të dytë mësimi", "Ndryshim vetë të diçkaje ekzistuese", "Zbatim vetë të çmimeve, produkteve apo politikave", "Lista frazash për të kuptuar mesazhet"].map(i => <li key={i}>{i}</li>)}</ul></div>
      </div>
    </Section>

    <Section id="vendimet" title="Vendimet që presin">
      <ol className={m.decisions}>{decisions.map(([title, text]) => <li key={title}><strong>{title}</strong><span className="muted-copy">{text}</span></li>)}</ol>
    </Section>

    <p className={m.footer}>Plan i nxjerrë nga leximi i kodit më 20 nëntor 2026: <code>src/lib/conversation-training</code>, <code>src/lib/agents/training</code>, <code>src/lib/knowledge</code>, <code>src/lib/agents/business-grounding.ts</code>, <code>src/lib/agents/instruction-facts.ts</code>, operacionet e Asistentit, <code>src/lib/tracking</code>, <code>src/lib/conversations/escalation.ts</code> dhe migrimet përkatëse.</p>
  </div>;
}
