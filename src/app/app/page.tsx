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
		<main className="page page-narrow">
			<div className="mb-10 flex items-start justify-between gap-4">
				<div>
					<p className="brand-mark text-2xl text-ink">Agjenti</p>
					<h1 className="mt-3 text-xl text-ink">Bizneset e tua</h1>
					<p className="mt-1 text-xs text-ink-muted">{user.email}</p>
					{admin ? (
						<p className="mt-2 text-sm text-ink-muted">
							Platform Admin ·{" "}
							<Link className="text-accent underline decoration-accent/30 underline-offset-4" href="/admin/businesses">
								Menaxho bizneset
							</Link>
						</p>
					) : (
						<p className="mt-2 text-sm text-ink-muted">Zgjidh një biznes për të hapur inbox-in.</p>
					)}
				</div>
				<form action={signOut}>
					<button className="btn btn-ghost px-3 py-2 text-sm" type="submit">
						Dil
					</button>
				</form>
			</div>

			{businesses.length === 0 ? (
				<p className="panel p-5 text-ink-muted">
					Nuk ke ende asnjë biznes. Platform Admin duhet të të shtojë.
				</p>
			) : (
				<ul className="panel overflow-hidden">
					{businesses.map((b) => (
						<li key={b.id}>
							<Link className="list-row group" href={`/b/${b.slug}/inbox`}>
								<span className="font-display text-lg font-semibold text-ink group-hover:text-accent">
									{b.name}
								</span>
								<span className="mt-1 block text-sm text-ink-muted">{b.slug}</span>
							</Link>
						</li>
					))}
				</ul>
			)}
		</main>
	);
}
