import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";

export default async function AdminBusinessesPage() {
	const user = await getSessionUser();
	if (!user || !(await isPlatformAdmin(user.id))) redirect("/app");
	const service = createServiceSupabase();
	const { data: businesses } = await service
		.from("businesses")
		.select("id,name,slug,catalog_source,auto_reply")
		.order("name");

	async function createBusiness(formData: FormData) {
		"use server";
		const session = await getSessionUser();
		if (!session || !(await isPlatformAdmin(session.id))) return;
		const name = String(formData.get("name") ?? "").trim();
		const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
		const catalog_source = String(formData.get("catalog_source") ?? "internal");
		const auto_reply = formData.get("auto_reply") === "on";
		if (!name || !slug) return;
		const db = createServiceSupabase();
		await db.from("businesses").insert({ name, slug, catalog_source, auto_reply });
		revalidatePath("/admin/businesses");
	}

	async function addMember(formData: FormData) {
		"use server";
		const session = await getSessionUser();
		if (!session || !(await isPlatformAdmin(session.id))) return;
		const businessId = String(formData.get("business_id") ?? "");
		const email = String(formData.get("email") ?? "").trim().toLowerCase();
		const db = createServiceSupabase();
		const { data: profile } = await db.from("profiles").select("id").eq("email", email).maybeSingle();
		if (!profile) return;
		await db.from("business_users").upsert({
			business_id: businessId,
			user_id: profile.id,
			role: "staff",
		});
		revalidatePath("/admin/businesses");
	}

	return (
		<main className="page page-narrow space-y-8">
			<div>
				<Link href="/app" className="text-sm text-ink-muted underline underline-offset-4">
					← Kthehu
				</Link>
				<p className="brand-mark mt-4 text-2xl text-ink">Agjenti</p>
				<h1 className="mt-2 text-xl text-ink">Menaxho bizneset</h1>
			</div>

			<form action={createBusiness} className="panel grid gap-3 p-5">
				<p className="font-display text-base font-semibold text-ink">Biznes i ri</p>
				<input name="name" placeholder="Emri" className="field" required />
				<input name="slug" placeholder="slug" className="field" required />
				<select name="catalog_source" className="field">
					<option value="internal">Katalog manual</option>
					<option value="zana">Zana Store API</option>
					<option value="external">API e jashtme</option>
				</select>
				<label className="flex items-center gap-2 text-sm text-ink-muted">
					<input type="checkbox" name="auto_reply" className="accent-accent" /> Auto-reply
				</label>
				<button className="btn btn-primary" type="submit">
					Krijo biznes
				</button>
			</form>

			<ul className="space-y-4">
				{(businesses ?? []).map((b) => (
					<li key={b.id} className="panel p-5">
						<p className="font-display text-lg font-semibold text-ink">
							{b.name}{" "}
							<span className="text-sm font-normal text-ink-muted">/{b.slug}</span>
						</p>
						<p className="mt-1 text-sm text-ink-muted">
							{b.catalog_source} · auto-reply {b.auto_reply ? "on" : "off"}
						</p>
						<form action={addMember} className="mt-4 flex flex-col gap-2 sm:flex-row">
							<input type="hidden" name="business_id" value={b.id} />
							<input
								name="email"
								type="email"
								placeholder="email stafi"
								className="field flex-1"
							/>
							<button className="btn btn-ghost" type="submit">
								Shto
							</button>
						</form>
					</li>
				))}
			</ul>
		</main>
	);
}
