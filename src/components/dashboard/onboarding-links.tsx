"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/dashboard/icon";
import {
  exploreProfileOrder,
  profileLinkRows,
  stepIndex,
  wizardSteps,
  type ProfileLinkRow,
  type WizardStep,
} from "@/lib/onboarding/map";
import type { AnswerKey } from "@/lib/onboarding/model";
import type { BusinessType, Choice } from "@/lib/onboarding/rules";

function Chip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "soft";
}) {
  return <span className={`ob-chip ob-chip-${tone}`}>{children}</span>;
}

function StatusDot({ on }: { on: boolean }) {
  return (
    <span
      className={`ob-dot ${on ? "is-on" : "is-off"}`}
      aria-label={on ? "Aktiv" : "I fikur"}
    />
  );
}

function StepCard({
  step,
  enabled,
  selected,
  onSelect,
}: {
  step: WizardStep;
  enabled: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`ob-step-card${selected ? " is-selected" : ""}${enabled ? "" : " is-disabled"}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="ob-step-card-top">
        <span className="ob-step-num">
          {String(step.index).padStart(2, "0")}
        </span>
        <StatusDot on={enabled} />
      </span>
      <strong>{step.shortLabel}</strong>
      <small>{step.key}</small>
    </button>
  );
}

function FlowColumn({
  title,
  items,
  icon,
}: {
  title: string;
  items: Choice[];
  icon: string;
}) {
  return (
    <div className="ob-flow-col">
      <div className="ob-flow-col-head">
        <span className="icon-tile">
          <Icon name={icon} size={18} />
        </span>
        <p>{title}</p>
      </div>
      <ul>
        {items.slice(0, 5).map(([value, label]) => (
          <li key={value}>{label}</li>
        ))}
        {items.length > 5 && (
          <li className="muted-copy">+{items.length - 5} të tjera</li>
        )}
      </ul>
    </div>
  );
}

function ExplorePanel({
  profiles,
  selectedType,
  onSelectType,
}: {
  profiles: ProfileLinkRow[];
  selectedType: BusinessType;
  onSelectType: (type: BusinessType) => void;
}) {
  const tabs = exploreProfileOrder
    .map((type) => profiles.find((row) => row.businessType === type))
    .filter((row): row is ProfileLinkRow => Boolean(row));
  const active =
    tabs.find((row) => row.businessType === selectedType) ?? tabs[0];
  if (!active) return null;

  return (
    <section className="panel section-pad ob-explore">
      <div className="ob-section-head">
        <div>
          <h2>Eksploro sipas llojit të biznesit</h2>
          <p className="muted-copy">
            Shiko si ndryshojnë oferta, qëllimet dhe aftësitë për çdo profil.
          </p>
        </div>
      </div>
      <div className="ob-tabs" role="tablist" aria-label="Llojet e biznesit">
        {tabs.map((tab) => (
          <button
            key={tab.businessType}
            type="button"
            role="tab"
            aria-selected={tab.businessType === active.businessType}
            className={`ob-tab${tab.businessType === active.businessType ? " is-active" : ""}`}
            onClick={() => onSelectType(tab.businessType)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="ob-flow-diagram">
        <FlowColumn
          title="Lloji i biznesit"
          items={[[active.businessType, active.label, "businesses"]]}
          icon="businesses"
        />
        <span className="ob-flow-arrow" aria-hidden>
          →
        </span>
        <FlowColumn
          title="Oferta të lejuara"
          items={active.offerings}
          icon="products"
        />
        <span className="ob-flow-arrow" aria-hidden>
          →
        </span>
        <FlowColumn
          title="Qëllimet (Use cases)"
          items={active.useCases}
          icon="spark"
        />
        <span className="ob-flow-arrow" aria-hidden>
          →
        </span>
        <FlowColumn
          title="Aftësitë e Agjentit"
          items={active.capabilities}
          icon="agents"
        />
      </div>
    </section>
  );
}

function StepDetail({
  step,
  enabled,
  steps,
}: {
  step: WizardStep;
  enabled: boolean;
  steps: WizardStep[];
}) {
  const byKey = new Map(steps.map((item) => [item.key, item]));

  return (
    <aside className="panel section-pad ob-detail">
      <p className="ob-detail-kicker">Detaje të hapit të zgjedhur</p>
      <div className="ob-detail-title">
        <div>
          <span className="ob-step-num">
            {String(step.index).padStart(2, "0")}
          </span>
          <h2>{step.shortLabel}</h2>
          <p className="muted-copy">{step.title}</p>
        </div>
        <span
          className={`status-badge status-${enabled ? "connected" : "paused"}`}
        >
          {enabled ? "Aktiv" : "I fikur"}
        </span>
      </div>

      <div className="ob-detail-block">
        <h3>Ndikohet nga</h3>
        {step.influencedBy.length ? (
          <ul className="ob-ref-list">
            {step.influencedBy.map((key) => {
              const ref = byKey.get(key)!;
              return (
                <li key={key}>
                  <span className="ob-ref-index">
                    {String(ref.index).padStart(2, "0")}
                  </span>
                  {ref.shortLabel}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted-copy">Nuk varet nga hapa të tjerë.</p>
        )}
      </div>

      <div className="ob-detail-block">
        <h3>Ndikon në</h3>
        {step.influences.length ? (
          <ul className="ob-ref-list">
            {step.influences.map((key) => {
              const ref = byKey.get(key)!;
              return (
                <li key={key}>
                  <span className="ob-ref-index">
                    {String(ref.index).padStart(2, "0")}
                  </span>
                  {ref.shortLabel}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted-copy">Nuk filtrron hapat e mëvonshëm.</p>
        )}
      </div>

      <div className="ob-detail-block">
        <h3>Opsionet e mundshme</h3>
        <div className="ob-chip-row">
          {step.options.map(([value, label]) => (
            <Chip key={value} tone="accent">
              {label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="ob-detail-help">
        <h3>Si funksionon?</h3>
        <p>{step.howItWorks}</p>
      </div>
    </aside>
  );
}

function RulesMatrix({
  profiles,
  filter,
  onFilter,
}: {
  profiles: ProfileLinkRow[];
  filter: BusinessType | "all";
  onFilter: (value: BusinessType | "all") => void;
}) {
  const rows =
    filter === "all"
      ? profiles
      : profiles.filter((row) => row.businessType === filter);

  return (
    <section className="panel section-pad ob-matrix">
      <div className="ob-section-head">
        <div>
          <h2>Matrica e rregullave</h2>
          <p className="muted-copy">
            Pamje e plotë: lloji i biznesit → oferta → qëllime → aftësi.
          </p>
        </div>
        <label className="ob-filter">
          <span className="muted-copy">Filtro</span>
          <select
            className="field"
            value={filter}
            onChange={(event) =>
              onFilter(event.target.value as BusinessType | "all")
            }
          >
            <option value="all">Të gjitha</option>
            {profiles.map((row) => (
              <option key={row.businessType} value={row.businessType}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="table-scroll">
        <table className="data-table ob-matrix-table">
          <thead>
            <tr>
              <th>Lloji i biznesit</th>
              <th>Oferta të lejuara</th>
              <th>Qëllimet</th>
              <th>Aftësitë e Agjentit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.businessType}>
                <td>
                  <strong>{row.label}</strong>
                  <div className="muted-copy">{row.businessType}</div>
                </td>
                <td>
                  <div className="ob-chip-row">
                    {row.offerings.map(([value, label]) => (
                      <Chip key={value}>{label}</Chip>
                    ))}
                  </div>
                </td>
                <td>
                  <div className="ob-chip-row">
                    {row.useCases.map(([value, label]) => (
                      <Chip key={value} tone="soft">
                        {label}
                      </Chip>
                    ))}
                  </div>
                </td>
                <td>
                  <div className="ob-chip-row">
                    {row.capabilities.slice(0, 8).map(([value, label]) => (
                      <Chip key={value} tone="accent">
                        {label}
                      </Chip>
                    ))}
                    {row.capabilities.length > 8 && (
                      <Chip>+{row.capabilities.length - 8}</Chip>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function OnboardingLinks({
  enabledSteps,
}: {
  enabledSteps: readonly AnswerKey[];
}) {
  const steps = useMemo(() => wizardSteps(), []);
  const profiles = useMemo(() => profileLinkRows(), []);
  const enabled = useMemo(() => new Set(enabledSteps), [enabledSteps]);
  const [selectedKey, setSelectedKey] = useState<AnswerKey>("aiMode");
  const [exploreType, setExploreType] = useState<BusinessType>("retail");
  const [matrixFilter, setMatrixFilter] = useState<BusinessType | "all">("all");

  const selected = steps.find((step) => step.key === selectedKey) ?? steps[0];
  const dependencyPairs = useMemo(() => {
    const pairs: Array<[AnswerKey, AnswerKey]> = [
      ["businessType", "productType"],
      ["productType", "useCases"],
      ["useCases", "aiMode"],
    ];
    return pairs;
  }, []);

  return (
    <div className="ob-map">
      <section className="panel section-pad ob-stepper-panel">
        <div className="ob-legend">
          <span>
            <StatusDot on /> Aktiv
          </span>
          <span>
            <StatusDot on={false} /> I fikur
          </span>
          <span>
            <span className="ob-legend-line" aria-hidden /> Lidhje / varësi
          </span>
          <span>
            <span className="ob-legend-selected" aria-hidden /> Hapi i zgjedhur
          </span>
        </div>

        <div className="ob-stepper" role="list">
          {steps.map((step, index) => {
            const next = steps[index + 1];
            const hasDependency =
              next &&
              dependencyPairs.some(
                ([from, to]) => from === step.key && to === next.key,
              );
            const showDependencyArc = step.key === "useCases" && next?.key === "aiMode";
            return (
              <div key={step.key} className="ob-stepper-item" role="listitem">
                <StepCard
                  step={step}
                  enabled={enabled.has(step.key)}
                  selected={step.key === selectedKey}
                  onSelect={() => setSelectedKey(step.key)}
                />
                {next && (
                  <div
                    className={`ob-connector${hasDependency ? " has-link" : ""}`}
                    aria-hidden
                  >
                    <span className="ob-connector-line" />
                    {showDependencyArc && (
                      <span
                        className="ob-connector-back"
                        title={`Varësi nga hapi ${String(stepIndex("useCases")).padStart(2, "0")}`}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="ob-main">
        <ExplorePanel
          profiles={profiles}
          selectedType={exploreType}
          onSelectType={setExploreType}
        />
        <StepDetail
          step={selected}
          enabled={enabled.has(selected.key)}
          steps={steps}
        />
      </div>

      <RulesMatrix
        profiles={profiles}
        filter={matrixFilter}
        onFilter={setMatrixFilter}
      />
    </div>
  );
}
