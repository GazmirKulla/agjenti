import Link from "next/link";
import { Fragment } from "react";
import type { TestConfigurationProvenance } from "@/lib/agents/configuration-contract";

/** The business's knowledge entries by id, as the test page read them. */
export type TestKnowledge = Record<string, { title: string; active: boolean }>;

const knowledgeHref = (slug: string, id: string) => `/b/${slug}/knowledge?entry=${id}`;

/** Above the conversation when the test was opened from one knowledge entry. */
export function TestKnowledgeFocus({ slug, id, knowledge }: { slug: string; id: string; knowledge: TestKnowledge }) {
  const entry = knowledge[id];
  if (!entry) return <p className="chat-status" role="status">Njohuria që po provoje nuk u gjet. Mund të jetë fshirë. <Link href={`/b/${slug}/knowledge`}>Hap Njohuritë →</Link></p>;
  return <p className="test-knowledge-focus" role="status">
    Po provon njohurinë <b>“{entry.title}”</b>.{" "}
    {entry.active
      ? "Pyet si klient për këtë temë. Pas çdo përgjigjeje shikon nëse u përzgjodh në informacionin e Agjentit."
      : "Është e fikur, prandaj Agjenti nuk e merr. Ndize “Përdoret nga Agjenti” që ta provosh."}
    {" "}<Link href={knowledgeHref(slug, id)}>Ndrysho njohurinë →</Link>
  </p>;
}

/** The read failed or was not checked (as opposed to: it ran and did not pick this entry). */
export function knowledgeReadFailed(read: NonNullable<TestConfigurationProvenance["knowledge"]>) {
  return read.status === "unavailable" || read.status === "unverified" || read.reason === "semantic_context_unavailable";
}

/**
 * Under each reply: which knowledge was selected for the reply's information and, for the entry being tested,
 * whether it was among it. Selected is not proof the reply used it correctly; an active entry is selected only
 * when it fits the question; a failed read is said as such, never as "not selected".
 */
export function TestKnowledgeUsed({ slug, configuration, knowledge, focus }: {
  slug: string; configuration?: TestConfigurationProvenance; knowledge: TestKnowledge; focus?: string;
}) {
  const read = configuration?.knowledge;
  if (!read) return focus ? <p className="chat-knowledge-used">Nuk u konfirmua cilat njohuri iu dhanë Agjentit për këtë përgjigje.</p> : null;
  const entries = read.ids.flatMap(id => knowledge[id] ? [{ id, ...knowledge[id] }] : []);
  const focused = focus && knowledge[focus];
  const failed = knowledgeReadFailed(read);
  return <div className="chat-knowledge-used">
    {failed && <p className="test-knowledge-miss">Leximi i njohurive dështoi për këtë përgjigje, prandaj nuk dihet nëse do të përzgjidhej{focused ? ` “${focused.title}”` : " ndonjë njohuri"}. Provo përsëri.</p>}
    {focused && !failed && (read.ids.includes(focus)
      ? <p className="test-knowledge-hit">“{focused.title}” u përzgjodh në informacionin për këtë përgjigje. Kjo nuk provon që përgjigjja e përdori saktë: kontrolloje vetë.</p>
      : <p className="test-knowledge-miss">“{focused.title}” nuk u përzgjodh për këtë përgjigje.{focused.active ? " Agjenti e merr kur pyetja lidhet me të; provo një pyetje më të afërt ose qartëso titullin dhe përmbajtjen." : " Është e fikur."}</p>)}
    {entries.length
      ? <p><span>Informacioni i përzgjedhur:</span> {entries.map((entry, index) => <Fragment key={entry.id}>{index ? " · " : ""}<Link href={knowledgeHref(slug, entry.id)}>{entry.title}</Link></Fragment>)}</p>
      : !focused && !failed && <p>Asnjë njohuri nuk u përzgjodh për këtë përgjigje.</p>}
    <p className="test-knowledge-fix">Diçka nuk shkon? <Link href={`/b/${slug}/knowledge`}>Korrigjo te Oferta</Link>, te <Link href={`/b/${slug}/agents/business`}>Biznesi</Link> ose te <Link href={`/b/${slug}/agents`}>Komunikimi</Link>.</p>
  </div>;
}

const profileSectionLabels: Record<string, string> = { identity: "Identiteti", contacts: "Kontaktet", location: "Vendndodhja", hours: "Orari" };
/**
 * Under each reply: which parts of the business profile the reply was given, each with Ndrysho këtu to its field.
 * A failed read is said as such; an empty profile is said as missing information, not as a fault.
 */
export function TestProfileUsed({ slug, configuration, profileHref }: { slug: string; configuration?: TestConfigurationProvenance; profileHref?: string }) {
  const read = configuration?.profile;
  if (!read) return null;
  const href = (section: string) => `${profileHref ?? `/b/${slug}/agents/business`}#profile-${section}`;
  if (read.status !== "complete") return <p className="chat-knowledge-used test-knowledge-miss">Leximi i profilit të biznesit dështoi për këtë përgjigje; Agjenti nuk i pati kontaktet, adresën dhe orarin.</p>;
  if (!read.sections.length) return <p className="chat-knowledge-used">Profili i biznesit nuk thotë ende kontaktet, adresën apo orarin. <Link href={href("contacts")}>Plotëso profilin</Link></p>;
  return <p className="chat-knowledge-used"><span>Profili i biznesit i dhënë:</span> {read.sections.map((section, index) => <Fragment key={section}>{index ? " · " : ""}{profileSectionLabels[section] ?? section} (<Link href={href(section)}>Ndrysho këtu</Link>)</Fragment>)}</p>;
}

type Presented = { id: string; name: string };
/** Under each reply: the products and services it presented, each with Ndrysho këtu to its own editor (and back). */
export function TestCatalogUsed({ slug, products, services, returnTo }: { slug: string; products?: Presented[]; services?: Presented[]; returnTo?: string }) {
  if (!products?.length && !services?.length) return null;
  const back = returnTo ? `&nga=${encodeURIComponent(returnTo)}` : "";
  return <p className="chat-knowledge-used"><span>Paraqiti:</span>{" "}
    {(products ?? []).map((product, index) => <Fragment key={`p${product.id}`}>{index ? " · " : ""}{product.name} (<Link href={`/b/${slug}/products/${product.id}?edit=1${back}`}>Ndrysho këtu</Link>)</Fragment>)}
    {(services ?? []).map((service, index) => <Fragment key={`s${service.id}`}>{index || products?.length ? " · " : ""}{service.name} (<Link href={`/b/${slug}/services?edit=${service.id}${back}`}>Ndrysho këtu</Link>)</Fragment>)}
  </p>;
}

const actionLabels: Partial<Record<string, string>> = {
  "booking.create": "Krijimi i rezervimit", "booking.change": "Ndryshimi i rezervimit", "booking.availability": "Kontrolli i orareve të lira",
  "booking.status": "Leximi i rezervimit", "order.create": "Regjistrimi i porosisë", "orders.status": "Leximi i statusit të porosisë",
  "staff.handoff": "Kalimi te stafi", "customer.message": "Mesazhi te klienti", "payment.process": "Pagesa",
};
const dispositions: Record<string, string> = {
  SIMULATED: "u simulua; në një bisedë reale do të kryhej",
  UNVERIFIED: "nuk u verifikua; mos e merr si të kryer",
  BLOCKED: "u bllokua; nuk do të kryhej as në bisedë reale",
  UNSUPPORTED: "nuk mbështetet në provë",
};
/**
 * Under each reply: what the agent would have done for real, and that in the test nothing was done. Only the
 * actions an owner recognises are named; internal plumbing (HTTP, jobs, database) is left out.
 */
export function TestActionsUsed({ actions }: { actions?: { kind: string; disposition: string }[] }) {
  const shown = (actions ?? []).filter(action => actionLabels[action.kind]);
  if (!shown.length) return null;
  return <p className="chat-knowledge-used"><span>Veprimet:</span>{" "}
    {shown.map((action, index) => <Fragment key={`${action.kind}${index}`}>{index ? " · " : ""}{actionLabels[action.kind]}: {dispositions[action.disposition] ?? "gjendje e panjohur"}</Fragment>)}
    . Prova nuk krijon porosi, rezervime ose mesazhe reale.</p>;
}
