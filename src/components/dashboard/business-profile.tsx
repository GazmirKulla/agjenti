import Link from "next/link";
import { answerLabel, type AnswerKey } from "@/lib/onboarding/model";
import { detailFields } from "@/lib/onboarding/audio-fields";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && !!item.trim())
    : typeof value === "string" && value.trim() ? [value] : [];
}

export function BusinessProfile({ answers, slug, failed = false }: {
  answers: unknown;
  slug: string;
  failed?: boolean;
}) {
  const saved = record(answers);
  const profile = { ...record(saved.businessProfile), ...record(saved.confirmedProfile) };
  const details = { ...profile, ...record(profile.details), ...record(saved.details) };
  const choice = (key: AnswerKey, value: unknown) => strings(value).map(item => answerLabel(key, item));
  const basics = [
    ["Emri gjatë regjistrimit", strings(saved.name)],
    ["Kategoria e biznesit", choice("businessType", saved.businessType || profile.businessType || details.businessCategory)],
    ["Lloji i ofertës", choice("productType", saved.offeringTypes ?? profile.offeringTypes ?? saved.productType)],
    ["Numri i produkteve ose shërbimeve", choice("productCount", saved.productCount)],
    ["Mesazhet mujore", choice("messageVolume", saved.messageVolume)],
    ["Madhësia e ekipit", choice("teamSize", saved.teamSize)],
  ] as const;
  const description = Object.entries(detailFields)
    .filter(([key]) => key !== "businessCategory")
    .map(([key, label]) => [label, typeof details[key] === "boolean"
      ? [details[key] ? "Po" : "Jo"] : strings(details[key])] as const);
  const agent = [
    ["Qëllimet e agjentit", choice("useCases", saved.useCases ?? saved.selectedUseCases ?? profile.selectedUseCases)],
    ["Aftësitë e zgjedhura", choice("aiMode", saved.agentCapabilities ?? profile.agentCapabilities ?? saved.aiMode)],
  ] as const;
  const groups = [
    { title: "Të dhënat bazë", fields: basics },
    { title: "Oferta dhe mënyra e punës", fields: description },
    { title: "Agjenti AI", fields: agent },
  ].map(group => ({ ...group, fields: group.fields.filter(([, values]) => values.length) }))
    .filter(group => group.fields.length);

  return (
    <section id="business-profile" className="panel section-pad grid gap-5" aria-labelledby="business-profile-title">
      <div className="section-title"><h2 id="business-profile-title">Profili i biznesit</h2></div>
      <p className="muted-copy">Të dhënat që ke dhënë gjatë onboarding, të mbledhura në një vend.</p>
      {failed ? <p role="alert" className="muted-copy">Nuk u ngarkuan detajet e profilit. Rifresko faqen për të provuar përsëri.</p>
        : groups.length ? groups.map(group => (
          <div key={group.title} className="grid gap-4">
            <h3 className="font-semibold">{group.title}</h3>
            <dl className="grid gap-4">
              {group.fields.map(([label, values]) => (
                <div key={label} className="grid gap-1 min-w-0">
                  <dt className="muted-copy">{label}</dt>
                  <dd className="text-sm whitespace-pre-wrap break-words">
                    {values.length === 1 ? values[0] : <ul className="list-disc pl-5 space-y-1">{values.map((value, index) => <li key={index}>{value}</li>)}</ul>}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )) : <p className="muted-copy">Për këtë biznes nuk ka detaje të ruajtura nga onboarding.</p>}
      <div className="grid gap-2">
        <p className="muted-copy">Kjo është përmbledhja e regjistrimit. Udhëzimet që përdor agjenti mund t’i ndryshosh te Agjentët.</p>
        <Link className="soft-link" href={`/b/${slug}/agents`}>Hap udhëzimet e agjentit →</Link>
      </div>
    </section>
  );
}
