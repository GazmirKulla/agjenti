import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand/logo";
import { AccountDetails } from "@/components/account/details";
import { getSessionUser, listMemberships } from "@/lib/tenant/access";

export default async function AccountPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await listMemberships(user.id);
  if (access.admin) redirect("/admin/account");
  if (access.businesses[0]) redirect(`/b/${access.businesses[0].slug}/account`);

  return (
    <main className="account-page">
      <div className="account-page-inner">
        <header className="account-page-header">
          <Link href="/onboarding" className="account-brand"><BrandLogo size={32} /></Link>
          <Link href="/onboarding" className="btn btn-ghost">Vazhdo konfigurimin →</Link>
        </header>
        <AccountDetails />
      </div>
    </main>
  );
}
