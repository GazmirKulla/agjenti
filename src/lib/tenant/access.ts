import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";

export type BusinessRow = {
	id: string;
	name: string;
	slug: string;
	catalog_source: "internal" | "zana" | "external";
	auto_reply: boolean;
};

export async function getSessionUser() {
	const supabase = await createServerSupabase();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	return user;
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
	const supabase = createServiceSupabase();
	const { data } = await supabase
		.from("platform_admins")
		.select("user_id")
		.eq("user_id", userId)
		.maybeSingle();
	return Boolean(data?.user_id);
}

export async function listMemberships(userId: string) {
	const supabase = createServiceSupabase();
	const admin = await isPlatformAdmin(userId);
	if (admin) {
		const { data } = await supabase.from("businesses").select("id,name,slug,catalog_source,auto_reply").order("name");
		return { admin: true, businesses: (data ?? []) as BusinessRow[] };
	}
	const { data } = await supabase
		.from("business_users")
		.select("role, businesses (id, name, slug, catalog_source, auto_reply)")
		.eq("user_id", userId);
	const businesses = (data ?? [])
		.map((row) => row.businesses as unknown as BusinessRow | null)
		.filter((row): row is BusinessRow => Boolean(row));
	return { admin: false, businesses };
}

export async function requireBusinessAccess(userId: string, slug: string) {
	const { admin, businesses } = await listMemberships(userId);
	const business = businesses.find((item) => item.slug === slug);
	if (!business) return null;
	return { admin, business };
}
