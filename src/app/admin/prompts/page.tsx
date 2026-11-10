import { redirect } from "next/navigation";
import { PageHeading } from "@/components/dashboard/ui";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { promptCatalog, PROMPT_AREAS, type PromptArea, type PromptModel } from "@/lib/ai/prompts/catalog";
import "./prompts.css";

export const metadata = { title: "Promptet | Agjenti.app" };

const modelLabels: Record<PromptModel, string> = {
  customer: "Modeli i klientëve", assistant: "Modeli i asistentit", utility: "Model i shpejtë", vision: "Model me foto",
};

/** Every prompt the platform sends to the AI, grouped by where it is used. Read-only. */
export default async function AdminPromptsPage() {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/auth/continue");
  const prompts = promptCatalog();
  const areas = (Object.keys(PROMPT_AREAS) as PromptArea[]).filter((area) => prompts.some((prompt) => prompt.area === area));
  return <>
    <PageHeading
      eyebrow="PLATFORMA"
      title="Promptet"
      description={`${prompts.length} prompte që platforma i dërgon AI-së, të grupuara sipas vendit ku përdoren. Teksti është ai që përdoret sot; pjesët ‹…› plotësohen për çdo kërkesë. Vetëm për lexim.`}
    />
    <nav className="prompt-areas" aria-label="Zonat">
      {areas.map((area) => <a key={area} href={`#${area}`}>{PROMPT_AREAS[area].title}<span>{prompts.filter((prompt) => prompt.area === area).length}</span></a>)}
    </nav>
    {areas.map((area) => (
      <section key={area} id={area} className="prompt-area" aria-labelledby={`${area}-title`}>
        <header>
          <h2 id={`${area}-title`}>{PROMPT_AREAS[area].title}</h2>
          <p>{PROMPT_AREAS[area].description}</p>
        </header>
        {prompts.filter((prompt) => prompt.area === area).map((prompt) => (
          <details key={prompt.id} id={prompt.id} className="prompt-card">
            <summary>
              <span className="prompt-card-title">{prompt.title}</span>
              <span className="prompt-card-use">{prompt.use}</span>
              <span className="prompt-card-meta">
                <span>{modelLabels[prompt.model]}</span>
                <span>{prompt.text.length.toLocaleString("sq-AL")} karaktere</span>
                {prompt.dynamic?.length ? <span>Me pjesë dinamike</span> : null}
              </span>
            </summary>
            <dl className="prompt-card-facts">
              <div><dt>Merr</dt><dd>{prompt.input}</dd></div>
              <div><dt>Kthen</dt><dd>{prompt.output}</dd></div>
              {prompt.dynamic?.length ? <div><dt>Plotësohet për çdo kërkesë</dt><dd>{prompt.dynamic.join(" · ")}</dd></div> : null}
              <div><dt>Në kod</dt><dd><code>{prompt.file}</code></dd></div>
            </dl>
            <pre className="prompt-card-text">{prompt.text}</pre>
          </details>
        ))}
      </section>
    ))}
  </>;
}
