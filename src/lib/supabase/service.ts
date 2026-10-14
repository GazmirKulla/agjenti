import { createClient } from "@supabase/supabase-js";
import { guardIsolatedClient } from "@/lib/runtime/isolated-client";

export function createServiceSupabase() {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) {
		throw new Error("Mungojnë çelësat e Supabase service role.");
	}
	return guardIsolatedClient(createClient(url, key, {
		auth: { persistSession: false, autoRefreshToken: false },
	}));
}
