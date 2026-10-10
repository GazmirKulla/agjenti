import { requireEnabledModule } from "@/lib/dashboard/modules/permissions";
import { createServiceSupabase } from "@/lib/supabase/service";
import { ServicesWorkspace } from "@/components/services/workspace";
import { serviceColumns, type BusinessService } from "@/lib/services/model";
import { PageHeading } from "@/components/dashboard/ui";
import { loadVisualBindings } from "@/lib/workflows/visual/bindings";
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { access } = await requireEnabledModule(slug, "services");
  const [bindings, result] = await Promise.all([loadVisualBindings(access.business.id), createServiceSupabase()
    .from("booking_services")
    .select(serviceColumns)
    .eq("business_id", access.business.id)
    .order("created_at", { ascending: false })]);
  if (result.error) {
    if (["42P01", "42703", "PGRST205", "PGRST204"].includes(result.error.code))
      return (
        <>
          <PageHeading
            eyebrow="Shërbimet"
            title="Shërbimet e biznesit"
            description="Menaxho shërbimet dhe çmimet."
          />
          <div className="panel section-pad">
            Katalogu i shërbimeve kërkon përditësimin e databazës. Kontakto
            administratorin.
          </div>
        </>
      );
    throw new Error("Shërbimet nuk u ngarkuan. Provo përsëri.");
  }
  return (
    <ServicesWorkspace
      slug={slug}
      businessName={access.business.name}
      services={(result.data ?? []) as BusinessService[]}
      flowBindings={bindings.services.map(item => ({ id: item.id, flowId: item.flowId, name: item.flowLabel }))}
      workflowsEnabled={bindings.enabled}
    />
  );
}
