import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, listMemberships } from "@/lib/tenant/access";
import { homeForAccess } from "@/lib/auth/destination";
import { signOut } from "@/lib/auth/actions";
export default async function AccountPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const home = homeForAccess(await listMemberships(user.id));
  if (home !== "/account") redirect(home);
  return (
    <main className="page page-narrow">
      <div className="panel p-8">
        <Link href="/" className="brand-mark">
          Agjenti.app
        </Link>
        <h1 className="mt-6 text-2xl">Llogaria jote është gati</h1>
        <p className="my-4">
          Je identifikuar si {user.email}. Administratori duhet të lidhë këtë
          email me biznesin tënd për të hapur panelin.
        </p>
        <Link className="btn btn-primary" href="/auth/continue">
          Kontrollo qasjen
        </Link>
        <form action={signOut} className="mt-4">
          <button className="btn btn-ghost">Dil nga llogaria</button>
        </form>
      </div>
    </main>
  );
}
