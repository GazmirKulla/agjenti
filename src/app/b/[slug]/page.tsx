import { Suspense } from "react";
import { DashboardLoading } from "@/components/dashboard/loading";
import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { getSetupStatus } from "@/lib/setup/status";
import Link from "next/link";
import { Overview } from "@/components/dashboard/overview";
export default async function BusinessDashboard({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const setup = await getSetupStatus(access.business.id);
  if (setup.available && !setup.launched)
    return (
      <section className="panel section-pad">
        <h2 className="text-lg">Lëre aktivitetin të vijë natyrshëm</h2>
        <p className="muted-copy mt-2">
          Bisedat shfaqen kur klientët të shkruajnë. Klientët dhe porositë
          krijohen nga aktiviteti real; nuk janë hapa konfigurimi.
        </p>
        <Link href={`/b/${slug}/inbox`} className="soft-link mt-4">
          Shiko Inbox-in →
        </Link>
      </section>
    );
  return (
    <>
      <Suspense fallback={<DashboardLoading />}>
        <Overview business={access.business} />
      </Suspense>
    </>
  );
}
