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
      ? "Pyet si klient për këtë temë. Pas çdo përgjigjeje shikon nëse Agjenti e lexoi."
      : "Është e fikur, prandaj Agjenti nuk e lexon. Ndize “Përdoret nga Agjenti” që ta provosh."}
    {" "}<Link href={knowledgeHref(slug, id)}>Ndrysho njohurinë →</Link>
  </p>;
}

/**
 * Under each reply: the knowledge the reply could read and, for the entry being tested, whether it was among it.
 * Reading an entry is not proof that the reply used it, and an active entry is read only when it fits the question.
 */
export function TestKnowledgeUsed({ slug, configuration, knowledge, focus }: {
  slug: string; configuration?: TestConfigurationProvenance; knowledge: TestKnowledge; focus?: string;
}) {
  const read = configuration?.knowledge;
  if (!read) return focus ? <p className="chat-knowledge-used">Nuk u konfirmua cilat njohuri lexoi Agjenti për këtë përgjigje.</p> : null;
  const entries = read.ids.flatMap(id => knowledge[id] ? [{ id, ...knowledge[id] }] : []);
  const focused = focus && knowledge[focus];
  return <div className="chat-knowledge-used">
    {focused && (read.ids.includes(focus)
      ? <p className="test-knowledge-hit">“{focused.title}” u lexua për këtë përgjigje. Kontrollo nëse përgjigjja e thotë saktë.</p>
      : <p className="test-knowledge-miss">“{focused.title}” nuk u lexua për këtë përgjigje.{focused.active ? " Agjenti e lexon kur pyetja lidhet me të; provo një pyetje më të afërt ose qartëso titullin dhe përmbajtjen." : " Është e fikur."}</p>)}
    {entries.length
      ? <p><span>Informacioni i lexuar:</span> {entries.map((entry, index) => <Fragment key={entry.id}>{index ? " · " : ""}<Link href={knowledgeHref(slug, entry.id)}>{entry.title}</Link></Fragment>)}</p>
      : !focused && <p>Asnjë njohuri nuk u lexua për këtë përgjigje.</p>}
    <p className="test-knowledge-fix">Diçka nuk shkon? <Link href={`/b/${slug}/knowledge`}>Korrigjo te Njohuritë</Link> ose <Link href={`/b/${slug}/agents`}>te Sjellja dhe veprimet</Link>.</p>
  </div>;
}
