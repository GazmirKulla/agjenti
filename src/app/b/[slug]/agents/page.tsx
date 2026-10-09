import { ActionForm } from "@/components/dashboard/action-form";
import { IntelligenceTrigger } from "@/components/business-intelligence/trigger";
import Link from "next/link";
import { PageHeading } from "@/components/dashboard/ui";
import { Icon } from "@/components/dashboard/icon";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

async function loadAgentLimit(businessId: string) {
  const db = createServiceSupabase();
  const { data, error } = await db
    .from("businesses")
    .select("allow_multiple_agents")
    .eq("id", businessId)
    .maybeSingle();
  if (error && ["42P01", "PGRST205", "42703"].includes(error.code)) {
    return { allowMultiple: false, maxAgents: 1 };
  }
  if (error) throw new Error("Nuk u ngarkuan të dhënat.");
  const allowMultiple = Boolean(data?.allow_multiple_agents);
  return { allowMultiple, maxAgents: allowMultiple ? 2 : 1 };
}

export default async function AgentsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const db = createServiceSupabase();
  const [{ data: agents, error: loadError }, limit] = await Promise.all([
    db
      .from("ai_agents")
      .select("id,name,instructions,is_active")
      .eq("business_id", access.business.id),
    loadAgentLimit(access.business.id),
  ]);
  if (loadError) throw new Error("Nuk u ngarkuan të dhënat.");
  const canCreate = (agents?.length ?? 0) < limit.maxAgents;

  async function save(formData: FormData) {
    "use server";
    const session = await getSessionUser();
    if (!session) return { error: "Sesioni ka skaduar. Hyr përsëri." };
    const acc = await requireBusinessAccess(session.id, slug);
    if (!acc) return { error: "Nuk ke qasje në këtë biznes." };
    const supabase = createServiceSupabase();
    const id = String(formData.get("id") ?? "");
    const name = String(formData.get("name") ?? "Agjent");
    const instructions = String(formData.get("instructions") ?? "");
    const isActive = formData.get("is_active") === "on";
    if (!name.trim() || !instructions.trim())
      return { error: "Vendos emrin dhe udhëzimet e agjentit." };
    if (id) {
      const { data: existing } = await supabase
        .from("ai_agents")
        .select("id")
        .eq("id", id)
        .eq("business_id", acc.business.id)
        .maybeSingle();
      if (!existing) return { error: "Agjenti nuk u gjet në këtë biznes." };
    } else {
      const [{ count }, agentLimit] = await Promise.all([
        supabase
          .from("ai_agents")
          .select("id", { count: "exact", head: true })
          .eq("business_id", acc.business.id),
        loadAgentLimit(acc.business.id),
      ]);
      if ((count ?? 0) >= agentLimit.maxAgents) {
        return {
          error: agentLimit.allowMultiple
            ? "Ky biznes mund të ketë deri në dy agjentë."
            : "Ky biznes lejon vetëm një agjent. Kontakto administratorin për dy agjentë.",
        };
      }
    }
    if (isActive) {
      await supabase
        .from("ai_agents")
        .update({ is_active: false })
        .eq("business_id", acc.business.id)
        .throwOnError();
    }
    if (id) {
      await supabase
        .from("ai_agents")
        .update({ name, instructions, is_active: isActive })
        .eq("id", id)
        .eq("business_id", acc.business.id)
        .throwOnError();
    } else {
      const { error } = await supabase.from("ai_agents").insert({
        business_id: acc.business.id,
        name,
        instructions,
        is_active: isActive,
      });
      if (error) {
        if (error.message?.includes("agent_limit_reached")) {
          return {
            error:
              "U arrit limiti i agjentëve për këtë biznes. Kontakto administratorin nëse të duhen dy.",
          };
        }
        return { error: "Agjenti nuk u krijua. Provo përsëri." };
      }
    }
    revalidatePath(`/b/${slug}`, "layout");
  }

  const agentForm = (a?: {
    id: string;
    name: string;
    instructions: string;
    is_active: boolean;
  }) => (
    <ActionForm action={save} className="panel section-pad grid gap-5">
      <div className="section-title">
        <h2>{a ? a.name : "Agjent i ri"}</h2>
        <span className="icon-tile">
          <Icon name="agents" />
        </span>
      </div>
      {a && <input type="hidden" name="id" value={a.id} />}
      <label className="form-label">
        Emri i agjentit
        <input
          name="name"
          defaultValue={a?.name || "Agjent shitjesh"}
          className="field"
          required
        />
      </label>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="form-label mb-0">
            Udhëzimet për Agjentin (Prompt)
          </span>
          <IntelligenceTrigger source="ai_inferred">
            ✨ Gjenero Agent Instructions
          </IntelligenceTrigger>
        </div>
        <textarea
          name="instructions"
          defaultValue={
            a?.instructions ||
            "Përgjigju në gjuhën e klientit. Përdor çmimet nga katalogu dhe mos shpik informacion. Kërko vetëm të dhënat për hapin aktual të workflow-t."
          }
          rows={12}
          className="field"
          required
        />
        <p className="muted-copy">
          AI vlerëson katalogun aktiv dhe propozon udhëzime; rishikoji para se
          t’i ruash.
        </p>
      </div>
      <label className="toggle-label">
        <span>
          Agjenti aktiv
          <small>Vetëm një agjent mund të jetë aktiv për biznes.</small>
        </span>
        <input
          className="switch-input"
          type="checkbox"
          name="is_active"
          defaultChecked={a?.is_active ?? false}
        />
      </label>
      <button className="btn btn-primary w-fit" type="submit">
        {a ? "Ruaj ndryshimet" : "Krijo agjentin"}
      </button>
    </ActionForm>
  );
  return (
    <>
      <PageHeading
        title={`Agjenti AI i ${access.business.name}`}
        description="Konfiguro mënyrën si Agjenti AI komunikon me klientët."
      >
        <Link href={`/b/${slug}/agents/memory`} className="soft-link">
          Memoria e Agjentit →
        </Link>
      </PageHeading>
      <div className="panel section-pad mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold">
            Provo përgjigjet para dërgimit automatik
          </h2>
          <p className="muted-copy">
            Bisedë e përkohshme, pa Instagram dhe pa porosi reale.
          </p>
        </div>
        <Link href={`/b/${slug}/agents/test`} className="btn btn-ghost">
          Provo Agjentin →
        </Link>
      </div>
      <div className="configuration-layout">
        <div className="space-y-5">
          {(agents ?? []).map((a) => (
            <div key={a.id}>{agentForm(a)}</div>
          ))}
          {canCreate ? (
            <details className="panel section-pad" open={!agents?.length}>
              <summary className="cursor-pointer font-semibold">
                + Krijo një agjent të ri
              </summary>
              <div className="mt-5">{agentForm()}</div>
            </details>
          ) : (
            <div className="panel section-pad">
              <p className="muted-copy">
                {limit.allowMultiple
                  ? "Ky biznes ka arritur limitin e dy agjentëve."
                  : "Ky biznes lejon vetëm një agjent. Për një konfigurim të dytë, kërko aktivizimin te administratori i platformës."}
              </p>
            </div>
          )}
        </div>
        <aside className="space-y-5">
          <div className="panel section-pad">
            <div className="agent-illustration">
              <Icon name="agents" size={66} />
            </div>
            <h2 className="text-lg mt-5">Një asistent për biznesin tënd</h2>
            <p className="muted-copy">
              Përcakto tonin, rregullat dhe mënyrën e komunikimit në udhëzimet e
              agjentit. Përgjigjet mbështeten te produktet dhe njohuritë e
              biznesit.
            </p>
            <Link href={`/b/${slug}/knowledge`} className="soft-link">
              Menaxho njohuritë →
            </Link>
          </div>
          <div className="panel section-pad">
            <h2 className="text-lg">Përgjigjet automatike</h2>
            <p className="muted-copy">
              Aktivizimi i agjentit zgjedh konfigurimin. Dërgimi automatik
              kontrollohet edhe nga cilësimi i biznesit dhe statusi i bisedës.
            </p>
            <Link href={`/b/${slug}/settings`} className="soft-link">
              Hap cilësimet →
            </Link>
          </div>
        </aside>
      </div>
    </>
  );
}
