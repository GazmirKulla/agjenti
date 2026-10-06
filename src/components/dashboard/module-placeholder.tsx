import { EmptyState, PageHeading } from "@/components/dashboard/ui";
import { Icon } from "@/components/dashboard/icon";
import { moduleRegistry } from "@/lib/dashboard/modules/registry";
import type { ModuleId } from "@/lib/dashboard/modules/types";
import {
  loadDashboardProfile,
} from "@/lib/dashboard/profile/service";
import { isModuleEnabled } from "@/lib/dashboard/modules/permissions";
import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

export async function ModulePlaceholderPage({
  slug,
  moduleId,
  title,
  description,
}: {
  slug: string;
  moduleId: ModuleId;
  title: string;
  description: string;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const profile = await loadDashboardProfile(access.business.id);
  if (!isModuleEnabled(profile, moduleId)) redirect(`/b/${slug}`);
  const mod = moduleRegistry[moduleId];
  return (
    <>
      <PageHeading eyebrow={mod.label} title={title} description={description} />
      <section className="panel section-pad">
        <EmptyState
          title={`${mod.label} është aktiv`}
          description="Ky modul është i aktivizuar për hapësirën tënde. Funksionaliteti i plotë do të shtochet gradualisht; navigimi dhe paneli janë tashmë të përshtatur."
        />
        <p className="muted-copy mt-4">
          <Icon name={mod.icon} size={18} /> Menaxho modulet te Cilësimet.
        </p>
      </section>
    </>
  );
}
