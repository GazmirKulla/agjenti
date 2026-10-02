import Link from "next/link";
import { createServiceSupabase } from "@/lib/supabase/service";
import {
  parseAnswers,
  recommendations,
  answerLabel,
} from "@/lib/onboarding/model";
import { Icon } from "@/components/dashboard/icon";
import "./checklist.css";
export async function OnboardingChecklist({
  businessId,
  slug,
}: {
  businessId: string;
  slug: string;
}) {
  const db = createServiceSupabase();
  const { data, error } = await db
    .from("business_onboarding")
    .select("answers,completed_at")
    .eq("business_id", businessId)
    .maybeSingle();
  // Existing/admin-created tenants need no wizard or setup banner. During rollout
  // older databases keep their existing dashboards until the migration is applied.
  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") return null;
    throw new Error("Nuk u ngarkua konfigurimi i biznesit.");
  }
  if (!data?.completed_at) return null;
  let answers;
  try {
    answers = parseAnswers(data.answers, true);
  } catch {
    return null;
  }
  const counts = await Promise.all([
    db
      .from("instagram_connections")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("status", "connected"),
    db
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId),
    db
      .from("knowledge_entries")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId),
    db
      .from("ai_agents")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("is_active", true),
    db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("direction", "inbound"),
    db
      .from("workflows")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId),
  ]);
  if (counts.some((c) => c.error))
    throw new Error("Nuk u ngarkuan hapat e konfigurimit.");
  const [instagram, products, knowledge, agent, messages, workflows] =
    counts.map((c) => Boolean(c.count));
  const steps = [
    {
      id: "instagram",
      title: "Lidh Instagram-in",
      description: "Autorizo llogarinë profesionale të biznesit.",
      href: "instagram",
      done: instagram,
      icon: "instagram",
    },
    {
      id: "products",
      title:
        answers.productType === "services"
          ? "Shto shërbimin e parë"
          : "Shto produktin e parë",
      description: "Plotëso emrin, çmimin dhe përshkrimin në katalog.",
      href: "products",
      done: products,
      icon: "products",
    },
    {
      id: "knowledge",
      title: "Shto njohuritë e biznesit",
      description: "Politikat, oraret dhe përgjigjet për pyetjet e shpeshta.",
      href: "knowledge",
      done: knowledge,
      icon: "knowledge",
    },
    {
      id: "agent",
      title: "Rishiko dhe aktivizo agjentin",
      description: "Udhëzimet fillestare janë përgatitur nga përgjigjet e tua.",
      href: "agents",
      done: agent,
      icon: "agents",
    },
    ...(answers.aiMode === "workflow" ||
    answers.aiMode === "collect" ||
    answers.productType === "personalized" ||
    answers.useCases.includes("collection")
      ? [
          {
            id: "workflow",
            title: "Përcakto hapat e porosisë",
            description:
              "Workflow lidhet me llojin e produktit dhe mund të ndryshohet.",
            href: "workflows",
            done: workflows,
            icon: "workflows",
          },
        ]
      : []),
    {
      id: "test",
      title: "Provo bisedën e parë",
      description:
        "Pas lidhjes, dërgo një mesazh nga një llogari tjetër Instagram dhe kontrolloje në Inbox.",
      href: "inbox",
      done: messages,
      icon: "inbox",
    },
  ];
  if (
    answers.useCases.includes("support") &&
    !answers.useCases.includes("sales")
  ) {
    const [item] = steps.splice(2, 1);
    steps.splice(1, 0, item);
  }
  const done = steps.filter((s) => s.done).length;
  return (
    <section className="setup-panel" aria-labelledby="setup-heading">
      <div className="setup-heading">
        <span className="setup-symbol">
          <Icon name="spark" size={28} />
        </span>
        <div>
          <p>
            {answerLabel("businessType", answers.businessType)} · Hapat e parë
          </p>
          <h2 id="setup-heading">
            {done === steps.length
              ? "Hapat e parë u përfunduan"
              : "Hapësira jote është gati"}
          </h2>
          <span>
            {done} nga {steps.length} hapa të përfunduar · Të gjitha funksionet
            janë të disponueshme.
          </span>
        </div>
        <Link href={`/b/${slug}/settings`}>Cilësimet →</Link>
      </div>
      <progress
        aria-label="Hapat e përfunduar"
        max={steps.length}
        value={done}
      />
      <details open={done < steps.length}>
        <summary>
          {done === steps.length
            ? "Shiko konfigurimin dhe rekomandimet"
            : "Lista e konfigurimit dhe rekomandimet"}
        </summary>
        <div className="setup-columns">
          <ol>
            {steps.map((s, i) => (
              <li key={s.id}>
                <span className={`setup-number ${s.done ? "done" : ""}`}>
                  {s.done ? "✓" : i + 1}
                </span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.description}</p>
                </div>
                <Link
                  href={`/b/${slug}/${s.href}`}
                  aria-label={`${s.done ? "Shiko" : "Hap"}: ${s.title}`}
                >
                  {s.done ? "Shiko" : "Hap"} →
                </Link>
              </li>
            ))}
          </ol>
          <aside>
            <h3>
              <Icon name="spark" size={18} /> Rekomanduar për ty
            </h3>
            <ul>
              {recommendations(answers).map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
            <p>
              Preferencat nuk ndryshojnë lejet apo kufijtë e funksioneve.
              Agjentin, katalogun dhe automatizimin mund t’i përshtatësh në çdo
              kohë nga panelet përkatëse.
            </p>
          </aside>
        </div>
      </details>
    </section>
  );
}
