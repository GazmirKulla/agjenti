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
			<h1 className="mb-5 text-2xl text-ink">Inbox</h1>
			<ul className="panel overflow-hidden">
				{(conversations ?? []).length === 0 ? (
					<li className="p-5 text-ink-muted">Nuk ka biseda. Inbox-i fillon bosh.</li>
				) : (
					conversations!.map((c) => {
						const customer = c.customers as unknown as {
							display_name?: string;
							username?: string;
						} | null;
						return (
							<li key={c.id}>
								<Link className="list-row flex items-center justify-between gap-4" href={`/b/${slug}/inbox/${c.id}`}>
									<div className="min-w-0">
										<p className="font-semibold text-ink">
											{customer?.display_name || customer?.username || "Klient Instagram"}
											{c.unread_count ? (
												<span className="ml-2 inline-block rounded bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent">
													{c.unread_count}
												</span>
											) : null}
										</p>
										<p className="truncate text-sm text-ink-muted">{c.last_message_preview}</p>
									</div>
									<span className="shrink-0 text-xs uppercase tracking-wide text-ink-muted">
										{c.status}
									</span>
								</Link>
							</li>
						);
					})
				)}
			</ul>
		</div>
	);
}
