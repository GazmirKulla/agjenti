import Link from "next/link";
import { redirect } from "next/navigation";
import { ThemeSwitch } from "@/components/theme/theme-switch";
import { signOut } from "@/lib/auth/actions";
import { getSessionUser, listMemberships } from "@/lib/tenant/access";

export default async function AccountPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const access = await listMemberships(user.id);
  const displayName =
    (typeof user.user_metadata?.full_name === "string" &&
      user.user_metadata.full_name) ||
    (typeof user.user_metadata?.name === "string" && user.user_metadata.name) ||
    user.email?.split("@")[0] ||
    "Përdorues";
  const returnHref = access.admin
    ? "/admin"
    : access.businesses[0]
      ? `/b/${access.businesses[0].slug}`
      : "/onboarding";

  return (
    <main className="account-page">
      <div className="account-page-inner">
        <header className="account-page-header">
          <Link href={returnHref} className="account-brand">
            <span className="brand-symbol">A</span> Agjenti.app
          </Link>
          <Link href={returnHref} className="btn btn-ghost">
            ← Kthehu te paneli
          </Link>
        </header>

        <div className="account-page-title">
          <p>LLOGARIA JOTE</p>
          <h1>Profili dhe cilësimet</h1>
          <span>Menaxho të dhënat dhe preferencat e llogarisë tënde.</span>
        </div>

        <section className="account-card" aria-labelledby="account-details-title">
          <div className="account-user-summary">
            <span className="account-avatar">
              {displayName.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <h2>{displayName}</h2>
              <p>{access.admin ? "Administrator i platformës" : "Anëtar biznesi"}</p>
            </div>
          </div>
          <h2 id="account-details-title">Të dhënat e llogarisë</h2>
          <dl className="account-details">
            <div>
              <dt>Emri</dt>
              <dd>{displayName}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{user.email || "—"}</dd>
            </div>
            <div>
              <dt>Roli</dt>
              <dd>{access.admin ? "Platform Admin" : "Përdorues biznesi"}</dd>
            </div>
            {!access.admin && access.businesses.length > 0 && (
              <div>
                <dt>Bizneset</dt>
                <dd>{access.businesses.map((business) => business.name).join(", ")}</dd>
              </div>
            )}
          </dl>
        </section>

        <section className="account-card" aria-labelledby="account-appearance-title">
          <div>
            <h2 id="account-appearance-title">Pamja</h2>
            <p>Zgjidh mënyrën si shfaqet Agjenti.app në pajisjen tënde.</p>
          </div>
          <ThemeSwitch />
        </section>

        <section className="account-card account-signout">
          <div>
            <h2>Sesioni</h2>
            <p>Dil nga llogaria në këtë pajisje.</p>
          </div>
          <form action={signOut}>
            <button type="submit" className="btn btn-ghost">
              Dil nga llogaria
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
