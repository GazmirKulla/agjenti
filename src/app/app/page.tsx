import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, listMemberships } from "@/lib/tenant/access";
import { createServerSupabase } from "@/lib/supabase/server";

export default async function AppHome() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { admin, businesses } = await listMemberships(user.id);

  async function signOut() {
    "use server";
    const supabase = await createServerSupabase();
    await supabase.auth.signOut();
    redirect("/login");
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Bizneset</h1>
        <form action={signOut}>
          <button className="text-sm text-zinc-600 underline" type="submit">
            Dil
          </button>
        </form>
      </div>
      {admin ? (
        <p className="mb-4 text-sm text-zinc-600">
          Platform Admin. <Link className="underline" href="/admin/businesses">Menaxho bizneset</Link>
        </p>
      ) : null}
      {businesses.length === 0 ? (
        <p>Nuk ke ende asnjë biznes. Platform Admin duhet të të shtojë.</p>
      ) : (
        <ul className="space-y-2">
          {businesses.map((b) => (
            <li key={b.id}>
              <Link className="block rounded-lg border border-zinc-200 bg-white px-4 py-3" href={`/b/${b.slug}/inbox`}>
                {b.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
