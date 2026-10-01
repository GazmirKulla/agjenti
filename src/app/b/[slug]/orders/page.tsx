import { redirect } from "next/navigation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

export default async function OrdersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/app");
  const { data: orders } = await createServiceSupabase()
    .from("orders")
    .select("id,status,total_amount,external_order_id,created_at")
    .eq("business_id", access.business.id)
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Porosi</h1>
      <ul className="space-y-2">
        {(orders ?? []).length === 0 ? <li>Nuk ka porosi.</li> : null}
        {(orders ?? []).map((o) => (
          <li key={o.id} className="rounded border bg-white px-3 py-2">
            {o.id.slice(0, 8)} · {o.status}
            {o.external_order_id ? ` · jashtme ${o.external_order_id}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
