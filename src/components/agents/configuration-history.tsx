import { randomUUID } from "node:crypto";
import { ActionForm } from "@/components/dashboard/action-form";
import { listConfigurationVersions } from "@/lib/agent-configuration/service";
import { restoreConfiguration } from "@/lib/agent-configuration/actions";

const sources: Record<string, string> = {
  owner: "Ndryshim me dorë", assistant: "Nga Asistenti", sources: "Nga burimet", conversations: "Nga bisedat", memory: "Nga memoria",
  revert: "Rikthim", baseline: "Gjendja fillestare", system: "Ndryshim në panel",
};
const when = (value: string) => new Intl.DateTimeFormat("sq-AL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Tirane" }).format(new Date(value));

/** Secondary access to the three kept versions of the whole configuration; Rikthe brings one back as a new version. */
export async function ConfigurationHistory({ slug, businessId }: { slug: string; businessId: string }) {
  let versions;
  try { versions = await listConfigurationVersions(businessId); }
  catch { return <details className="configuration-history"><summary>Historiku i ndryshimeve</summary><p role="alert">Historiku nuk u ngarkua.</p></details>; }
  const current = versions[0]?.revision ?? 0;
  return <details className="configuration-history">
    <summary>Historiku i ndryshimeve</summary>
    <p className="muted-copy">Ruhen tri versionet e fundit të konfigurimit të Agjentit: njohuritë, udhëzimet, komunikimi, sjellja, mësimet dhe lejet e rezervimit. Rikthe e vë një version sërish në përdorim si version i ri; njohuritë e shtuara më pas fiken, nuk fshihen. Rezervimet, porositë dhe bisedat nuk preken.</p>
    {!versions.length ? <p className="muted-copy">Ende pa versione.</p> : <ol>
      {versions.map(version => <li key={version.revision}>
        <div><b>Versioni {version.revision}</b>{version.current && <span className="status-badge status-connected">Në përdorim</span>}
          <small>{sources[version.source] ?? version.source} · {when(version.created_at)}</small>
          {version.summary && <p>{version.summary}</p>}</div>
        {!version.current && <ActionForm action={restoreConfiguration.bind(null, slug)}>
          <input type="hidden" name="revision" value={version.revision} /><input type="hidden" name="base" value={current} /><input type="hidden" name="request_id" value={randomUUID()} />
          <button className="btn btn-ghost" type="submit">Rikthe</button>
        </ActionForm>}
      </li>)}
    </ol>}
  </details>;
}
