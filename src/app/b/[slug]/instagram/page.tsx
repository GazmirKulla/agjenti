import { redirect } from "next/navigation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

export default async function InstagramPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/app");
  const supabase = createServiceSupabase();
  const { data: conn } = await supabase
    .from("instagram_connections")
    .select("username,ig_user_id,status,expires_at,last_error")
    .eq("business_id", access.business.id)
    .neq("status", "disconnected")
    .maybeSingle();

  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-xl font-semibold">Instagram</h1>
      {conn ? (
        <div className="rounded-lg border bg-white p-4">
          <p>@{conn.username || conn.ig_user_id}</p>
          <p className="text-sm text-zinc-600">Status: {conn.status}</p>
          {conn.last_error ? <p className="text-sm text-red-700">{conn.last_error}</p> : null}
        </div>
      ) : (
        <p>Nuk ka llogari të lidhur.</p>
      )}
      <a
        className="inline-block rounded bg-zinc-900 px-4 py-2 text-white"
        href={`/api/instagram/oauth/start?businessId=${access.business.id}`}
      >
        {conn ? "Rilidh Instagram" : "Connect Instagram"}
      </a>
      {conn ? (
        <form action={`/api/businesses/${access.business.id}/instagram/disconnect`} method="post">
          <button className="text-sm underline" type="submit">
            Shkëput
          </button>
        </form>
      ) : null}
    </div>
  );
}
