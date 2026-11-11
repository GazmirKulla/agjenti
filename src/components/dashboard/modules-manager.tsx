"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { saveModules } from "@/lib/dashboard/modules/actions";
import "./modules-manager.css";

export type ModuleRow = { id: string; path: string; label: string; summary: string; details: string | null; allowed: boolean; shown: boolean };
export type ModuleGroup = { title: string; description: string; modules: ModuleRow[] };

/** The panel's sections, grouped as in the menu: switch one on or off and
 * save; the save bar stays in sight while there are unsaved changes. */
export function ModulesManager({ slug, groups, provisioning }: { slug: string; groups: ModuleGroup[]; provisioning: boolean }) {
  const initial = useMemo(() => new Set(groups.flatMap((group) => group.modules.filter((m) => m.allowed && m.shown).map((m) => m.id))), [groups]);
  const [saved, setSaved] = useState(initial);
  const [shown, setShown] = useState(initial);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const changed = shown.size !== saved.size || [...shown].some((id) => !saved.has(id));
  const base = `/b/${slug}`;

  function toggle(id: string) {
    setMessage(null);
    setShown((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function save() {
    const data = new FormData();
    for (const id of shown) data.set(`module_${id}`, "on");
    start(async () => {
      const result = await saveModules(slug, data).catch(() => ({ error: "Pamja nuk u ruajt. Provo përsëri." }));
      if (result && "error" in result && result.error) { setMessage({ text: result.error, error: true }); return; }
      setSaved(new Set(shown));
      setMessage({ text: "Menuja u përditësua." });
    });
  }

  return (
    <div className="modules-page">
      <header className="modules-head">
        <h2>Modulet</h2>
        <p>Zgjidh cilat seksione shfaqen në menu. Një seksion i fshehur nuk humbet të dhënat dhe Agjenti vazhdon t&apos;i përdorë; mund ta shfaqësh sërish kur të duash.</p>
      </header>
      {groups.map((group) => (
        <section key={group.title} className="modules-group" aria-labelledby={`modules-${group.title}`}>
          <div className="modules-group-head">
            <h3 id={`modules-${group.title}`}>{group.title}</h3>
            {group.description && <p>{group.description}</p>}
          </div>
          <ul>
            {group.modules.map((m) => (
              <li key={m.id} className={m.allowed ? undefined : "is-locked"}>
                <div className="modules-row-text">
                  <span className="modules-row-title">{m.label}</span>
                  <span className="modules-row-summary">{m.summary}</span>
                  {m.details && (
                    <details>
                      <summary>Shiko më shumë</summary>
                      <p>{m.details}</p>
                    </details>
                  )}
                  {!m.allowed && <span className="modules-row-locked">Nuk përfshihet në paketën tënde · <Link href={`${base}/settings/billing`}>Shiko paketat</Link></span>}
                </div>
                <div className="modules-row-actions">
                  {m.allowed && <Link className="modules-open" href={`${base}/${m.path}`}>Hap →</Link>}
                  <label className="modules-switch">
                    <span className="sr-only">Shfaq {m.label} në menu</span>
                    <input type="checkbox" className="switch-input" checked={m.allowed && shown.has(m.id)} disabled={!m.allowed || pending} onChange={() => toggle(m.id)} />
                  </label>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {provisioning && (
        <section className="modules-group modules-provision">
          <div className="modules-group-head">
            <h3>Krijimi i bizneseve për klientë</h3>
            <p>Përgatit një biznes dhe dërgo ftesën e pronësisë me email.</p>
          </div>
          <Link className="btn btn-ghost" href={`${base}/settings/actions`}>Hap krijimin e bizneseve →</Link>
        </section>
      )}
      <div className={`modules-savebar${changed || message ? " is-visible" : ""}`} role="region" aria-label="Ruajtja e moduleve">
        <span role={message?.error ? "alert" : "status"} className={message?.error ? "is-error" : undefined}>
          {message?.text ?? (changed ? "Ke ndryshime të paruajtura." : "")}
        </span>
        <div>
          {changed && <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => { setShown(new Set(saved)); setMessage(null); }}>Anulo</button>}
          <button type="button" className="btn btn-primary" disabled={!changed || pending} onClick={save}>{pending ? "Duke ruajtur…" : "Ruaj ndryshimet"}</button>
        </div>
      </div>
    </div>
  );
}
