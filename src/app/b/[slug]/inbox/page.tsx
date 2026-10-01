import Link from "next/link";
import { redirect } from "next/navigation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

export default async function InboxPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/app");
  const supabase = createServiceSupabase();
  const { data: conversations } = await supabase
    .from("conversations")
    .select("id,status,last_message_preview,last_message_at,unread_count,customers(display_name,username)")
    .eq("business_id", access.business.id)
    .order("last_message_at", { ascending: false })
    .limit(100);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Inbox</h1>
      <ul className="divide-y rounded-lg border bg-white">
        {(conversations ?? []).length === 0 ? (
          <li className="p-4 text-zinc-600">Nuk ka biseda. Inbox-i fillon bosh.</li>
        ) : (
          conversations!.map((c) => {
            const customer = c.customers as unknown as { display_name?: string; username?: string } | null;
            return (
              <li key={c.id}>
                <Link className="flex items-center justify-between px-4 py-3" href={`/b/${slug}/inbox/${c.id}`}>
                  <div>
                    <p className="font-medium">
                      {customer?.display_name || customer?.username || "Klient Instagram"}
                    </p>
                    <p className="text-sm text-zinc-600">{c.last_message_preview}</p>
                  </div>
                  <span className="text-xs uppercase text-zinc-500">{c.status}</span>
                </Link>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
