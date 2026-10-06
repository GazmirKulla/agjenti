import Link from "next/link";
import {
  parseMetadata,
  metadataLabels,
  ruleLabels,
  qualificationLabels,
  type Catalog,
} from "@/lib/catalogs/model";
import { saveCatalog } from "@/lib/catalogs/actions";
import { IndexCatalog } from "./create";
import { ActionForm } from "@/components/dashboard/action-form";
import { PageHeading } from "@/components/dashboard/ui";
export function CatalogDetail({
  c,
  slug,
  source,
  sections,
}: {
  c: Catalog;
  slug: string;
  source: string | null;
  sections: {
    id: string;
    heading: string;
    body: string;
    page: number | null;
  }[];
}) {
  const id = c.id;
  return (
    <>
      <Link href={`/b/${slug}/catalogs`}>← Katalogët</Link>
      <PageHeading
        eyebrow="Detajet e katalogut"
        title={c.title}
        description="Rishiko përmbajtjen, përzgjedhjen dhe pyetjet sqaruese përpara aktivizimit."
      />
      <div className="catalog-columns">
        <ActionForm
          key={c.revision}
          action={saveCatalog.bind(null, slug, id)}
          className="panel catalog-stack"
        >
          <input type="hidden" name="revision" value={c.revision} />
          <div className="catalog-stack">
            <label className="form-label">
              Titulli
              <input
                className="field"
                name="title"
                required
                defaultValue={c.title}
              />
            </label>
            <label className="form-label">
              Përshkrimi
              <textarea
                className="field"
                name="description"
                rows={3}
                defaultValue={c.description}
              />
            </label>
            <h2>Kategoritë dhe përmbajtja</h2>
            <p>
              Ndaj vlerat me presje. Gjuha, tregu dhe industria kufizojnë
              dokumentet që Agjenti propozon.
            </p>
            <div className="catalog-meta">
              {Object.entries(metadataLabels).map(([key, label]) => (
                <label className="form-label" key={key}>
                  {label}
                  <input
                    className="field"
                    name={key}
                    defaultValue={c.metadata[
                      key as keyof typeof c.metadata
                    ].join(", ")}
                  />
                </label>
              ))}
            </div>
            <h2>Kur duhet ta përdorë Agjenti?</h2>
            {Object.entries(ruleLabels).map(([key, label]) => (
              <label key={key}>
                <input
                  name="use_when"
                  value={key}
                  type="checkbox"
                  defaultChecked={c.use_when.includes(key)}
                />
                {label}
              </label>
            ))}
            <h2>Pyet para se të dërgosh materialin</h2>
            <p>Pyet vetëm për informacionin që mungon, një pyetje çdo herë.</p>
            {Object.entries(qualificationLabels).map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  name="qualification_fields"
                  value={key}
                  defaultChecked={c.qualification_fields.includes(key)}
                />
                {label}
              </label>
            ))}
            <label>
              <input
                name="confirm"
                type="checkbox"
                defaultChecked={!!c.confirmed_at}
              />
              Kam kontrolluar indeksin dhe rregullat e përdorimit.
            </label>
            <label>
              <input name="active" type="checkbox" defaultChecked={c.active} />
              Aktiv për Agjentin
            </label>
            <p>
              Aktivizimi lejon Agjentin të ndajë dokumentin me klientët përmes
              një linku publik. Çaktivizimi e mbyll këtë link.
            </p>
            <button className="btn btn-primary">Ruaj ndryshimet</button>
          </div>
        </ActionForm>
        <aside className="catalog-stack">
          <section className="panel catalog-stack">
            <h2>Burimi · {c.source_type.toUpperCase()}</h2>
            {source && (
              <a
                className="btn btn-ghost catalog-source"
                href={source}
                target="_blank"
                rel="noopener noreferrer"
              >
                Hap dokumentin origjinal ↗
              </a>
            )}
            <IndexCatalog
              slug={slug}
              id={id}
              indexing={c.index_status === "indexing"}
            />
            {c.index_error && <p role="alert">{c.index_error}</p>}
            <h2>Përmbledhja AI</h2>
            <p>
              {c.ai_summary || "Indekso dokumentin për të parë përmbledhjen."}
            </p>
            <details>
              <summary>Të dhënat e nxjerra nga burimi</summary>
              <p>
                Ndryshimet e tua ruhen gjatë riindeksimit. Krahaso sugjerimet e
                reja dhe përditëso fushat që dëshiron.
              </p>
              {Object.entries(parseMetadata(c.index_metadata))
                .filter(([, values]) => values.length)
                .map(([key, values]) => (
                  <p key={key}>
                    <strong>
                      {metadataLabels[key as keyof typeof metadataLabels]}:
                    </strong>{" "}
                    {values.join(", ")}
                  </p>
                ))}
            </details>
            <h2>Mbulimi i indeksit</h2>
            <p>{c.coverage || "Ende pa analizuar."}</p>
          </section>
        </aside>
      </div>
      <section className="panel">
        <h2>Përmbajtja e indeksuar · {sections.length ?? 0} seksione</h2>
        <p>
          Përgjigjet mbështeten te këto fragmente. Kontrollo referencat dhe
          specifikimet në dokumentin origjinal.
        </p>
        {sections.map((s) => (
          <details key={s.id} className="catalog-index-section">
            <summary>
              {s.heading}
              {s.page ? ` · Faqe ${s.page}` : ""}
            </summary>
            <pre>{s.body}</pre>
          </details>
        ))}
      </section>
    </>
  );
}
