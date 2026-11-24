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
    <p className="test-knowledge-fix">Diçka nuk shkon? <Link href={`/b/${slug}/knowledge`}>Korrigjo te Njohuritë</Link> ose <Link href={`/b/${slug}/agents`}>te Sjellja dhe veprimet</Link>.</p>
  </div>;
}
