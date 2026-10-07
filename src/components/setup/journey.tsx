"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { setupSteps, isReady, type SetupStatus } from "@/lib/setup/model";
import { launchBusiness } from "@/lib/setup/actions";
import type { BusinessProfileAnswers } from "@/lib/onboarding/rules";
import { ActionForm } from "@/components/dashboard/action-form";
import "./setup.css";
export function SetupJourney({
  status,
  slug,
  expanded = true,
  profile,
}: {
  status: SetupStatus;
  slug: string;
  expanded?: boolean;
  profile?: BusinessProfileAnswers | null;
}) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const media = matchMedia("(max-width: 760px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    let last = 0;
    const refresh = () => {
      if (document.visibilityState === "visible" && Date.now() - last > 3000) {
        last = Date.now();
        router.refresh();
      }
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);
  const steps = setupSteps(status);
  const next = steps.find((s) => !s.done) ?? steps[steps.length - 1];
  const [chosen, setChosen] = useState<string | null>(null);
  const active = steps.find((s) => s.key === chosen) ?? next;
  const count = steps.filter((s) => s.done).length;
  useEffect(() => {
    setChosen(null);
  }, [status.signature, count]);
  const home = `/b/${slug}`;
  const recommendedWorkflow: Record<string, string> = {
    "product-orders": "porosi produktesh",
    "personalized-order": "porosi me personalizim",
    "variant-order": "porosi me variante",
    "service-or-product-request": "kërkesa për shërbim ose produkt",
    "service-request": "kërkesa për shërbim",
    "business-defined": "proces sipas biznesit",
  };
  const onHome = pathname === `${home}/setup`;
  // Përgatitja dhe aktivizimi shfaqen vetëm në onboarding.
  if (!onHome) return null;
  if (!status.available)
    return (
      <div className="setup-notice" role="status">
        Konfigurimi po përgatitet. Administratori duhet të aplikojë përditësimin
        e databazës. Mund të vazhdosh përgatitjen nga menuja.
      </div>
    );
  if (status.launched && status.connected && status.tested) return null;
  if (!onHome || (!expanded && !isReady(status)) || status.launched)
    return (
      <aside className="setup-strip">
        <div>
          <strong>
            {!status.connected
              ? "Lidh Instagram-in për përdorimin real"
              : status.launched
                ? "Konfigurimi ndryshoi — rekomandohet një provë e re"
                : isReady(status)
                  ? "Gati për të filluar"
                  : `Konfigurimi · ${count}/${steps.length} hapa`}
          </strong>
          <p>
            {status.connected
              ? next.title
              : "Përgatitja ruhet. Bisedat reale kërkojnë një lidhje aktive."}
          </p>
        </div>
        <Link
          className="btn btn-primary"
          href={isReady(status) ? home : `${home}/${next.path}`}
        >
          {isReady(status) ? "Fillo përdorimin" : next.action}
        </Link>
        <button
          className="btn btn-ghost"
          onClick={() => router.refresh()}
          aria-label="Kontrollo progresin"
        >
          ↻
        </button>
      </aside>
    );
  return (
    <section className="setup-journey" aria-labelledby="setup-title">
      <header>
        <div>
          <p className="setup-eyebrow">
            HAPAT E PARË · {count}/{steps.length}
          </p>
          <h1 id="setup-title">
            {isReady(status)
              ? "Konfigurimi u përfundua"
              : "Le ta bëjmë biznesin gati"}
          </h1>
          <p>
            {isReady(status)
              ? "Zgjidh si dëshiron të fillosh. Mund ta ndryshosh më vonë nga cilësimet."
              : "Lidh Instagram-in, përgatit katalogun dhe provo agjentin përpara përdorimit real."}
          </p>
        </div>
        <button className="btn btn-ghost" onClick={() => router.refresh()}>
          Kontrollo progresin
        </button>
      </header>
      <progress
        value={count}
        max={steps.length}
        aria-label={`${count} nga ${steps.length} hapa të përfunduar`}
      />
      {isReady(status) ? (
        <ActionForm
          action={launchBusiness.bind(null, slug)}
          className="setup-launch"
        >
          <button
            className="btn btn-primary"
            name="mode"
            value="automatic"
            type="submit"
          >
            Aktivizo përgjigjet automatike
          </button>
          <button
            className="btn btn-ghost"
            name="mode"
            value="manual"
            type="submit"
          >
            Vazhdo me përgjigje manuale
          </button>
        </ActionForm>
      ) : (
        <div className="setup-grid">
          <details className="setup-step-list" open={!mobile}>
            <summary>Shiko {steps.length} hapat</summary>
            <ol>
              {steps.map((step, i) => (
                <li key={step.key}>
                  <button
                    type="button"
                    aria-current={active.key === step.key ? "step" : undefined}
                    onClick={() => setChosen(step.key)}
                  >
                    <span className={step.done ? "done" : ""}>
                      {step.done ? "✓" : i + 1}
                    </span>
                    <span>
                      {step.title}
                      <small>
                        {step.done
                          ? "Përfunduar"
                          : i === 0
                            ? "I detyrueshëm"
                            : next.key === step.key
                              ? "Hapi i radhës"
                              : "Mund ta përgatitësh"}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </details>
          <article className="setup-current">
            <span className="setup-eyebrow">
              HAPI {steps.indexOf(active) + 1} NGA {steps.length}
            </span>
            <h2>{active.title}</h2>
            <p>{active.description}</p>
            {profile && (
              <p className="setup-help">
                Rekomandim për konfigurimin tënd:{" "}
                {recommendedWorkflow[
                  profile.recommendedConfiguration.workflow
                ] ?? "proces sipas biznesit"}
                . Hapat kryesorë:{" "}
                {profile.recommendedConfiguration.checklist
                  .slice(0, 3)
                  .join(" · ")}
              </p>
            )}
            <Link className="btn btn-primary" href={`${home}/${active.path}`}>
              {active.done ? "Rishiko konfigurimin" : active.action} →
            </Link>
            {active.key === "agents" && (
              <Link className="soft-link" href={`${home}/knowledge`}>
                Shto politikat dhe njohuritë e biznesit →
              </Link>
            )}
            {active.key === "workflows" && (
              <Link className="soft-link" href={`${home}/products`}>
                Lidh produktet me llojin përkatës →
              </Link>
            )}
            <p className="setup-help">
              Progresi ruhet. Mund të vizitosh çdo faqe; aktivizimi bëhet vetëm
              kur konfigurimi është gati.
            </p>
          </article>
        </div>
      )}
    </section>
  );
}
