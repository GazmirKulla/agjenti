import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { isPlatformAdmin } from "@/lib/tenant/access";

export async function POST(
	request: Request,
	context: { params: Promise<{ id: string }> },
) {
	const { id } = await context.params;
	const auth = await createServerSupabase();
	const {
		data: { user },
	} = await auth.auth.getUser();
	if (!user || !(await isPlatformAdmin(user.id))) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}
	const body = (await request.json()) as { email?: string; role?: string };
	const email = body.email?.trim().toLowerCase();
	if (!email) return NextResponse.json({ error: "Mungon email." }, { status: 400 });
	const service = createServiceSupabase();
	const { data: profile } = await service.from("profiles").select("id").eq("email", email).maybeSingle();
	if (!profile) {
		return NextResponse.json(
			{ error: "Përdoruesi duhet të jetë regjistruar më parë në Agjenti." },
			{ status: 404 },
		);
	}
	const { error } = await service.from("business_users").upsert({
		business_id: id,
		user_id: profile.id,
		role: body.role === "owner" ? "owner" : "staff",
	});
	if (error) return NextResponse.json({ error: error.message }, { status: 400 });
	return NextResponse.json({ ok: true });
}
