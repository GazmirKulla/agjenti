import { createServiceSupabase } from "@/lib/supabase/service";

export type ExternalCatalogProduct = {
	id: string;
	name: string;
	productType: string | null;
	price: number | null;
	currency?: string;
	formats?: Array<{ id: string; name: string; price: number | null }>;
	colors?: Array<{ id: string; name: string }>;
};

export async function fetchLinkedCatalog(businessId: string): Promise<ExternalCatalogProduct[]> {
	const supabase = createServiceSupabase();
	const { data: business } = await supabase
		.from("businesses")
		.select("catalog_source")
		.eq("id", businessId)
		.maybeSingle();
	const { data: integration } = await supabase
		.from("integrations")
		.select("catalog_url, kind")
		.eq("business_id", businessId)
		.maybeSingle();

	const url =
		integration?.catalog_url ||
		(business?.catalog_source === "zana"
			? `${process.env.ZANA_API_BASE_URL?.replace(/\/$/, "")}/api/integrations/agjenti/catalog`
			: null);
	if (!url) return [];

	const secret = process.env.ZANA_AGJENTI_SECRET?.trim();
	const response = await fetch(url, {
		headers: secret ? { Authorization: `Bearer ${secret}` } : {},
		signal: AbortSignal.timeout(20_000),
	});
	if (!response.ok) {
		await supabase.from("integration_logs").insert({
			business_id: businessId,
			direction: "outbound",
			target: "catalog",
			status: "failed",
			error: `HTTP ${response.status}`,
		});
		return [];
	}
	const json = (await response.json()) as { products?: ExternalCatalogProduct[] };
	return json.products ?? [];
}

export async function submitExternalOrder(params: {
	businessId: string;
	payload: Record<string, unknown>;
}): Promise<{ ok: boolean; orderId?: string; orderNumber?: number; error?: string }> {
	const supabase = createServiceSupabase();
	const { data: business } = await supabase
		.from("businesses")
		.select("catalog_source")
		.eq("id", params.businessId)
		.maybeSingle();
	const { data: integration } = await supabase
		.from("integrations")
		.select("orders_url")
		.eq("business_id", params.businessId)
		.maybeSingle();
	const url =
		integration?.orders_url ||
		(business?.catalog_source === "zana"
			? `${process.env.ZANA_API_BASE_URL?.replace(/\/$/, "")}/api/integrations/agjenti/orders`
			: null);
	if (!url) return { ok: false, error: "Biznesi nuk ka API porosie." };

	const secret = process.env.ZANA_AGJENTI_SECRET?.trim();
	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(secret ? { Authorization: `Bearer ${secret}` } : {}),
		},
		body: JSON.stringify(params.payload),
		signal: AbortSignal.timeout(20_000),
	});
	const json = (await response.json().catch(() => null)) as {
		ok?: boolean;
		orderId?: string;
		orderNumber?: number;
		error?: string;
		reason?: string;
	} | null;
	if (!response.ok || !json?.ok) {
		await supabase.from("integration_logs").insert({
			business_id: params.businessId,
			direction: "outbound",
			target: "orders",
			status: "failed",
			error: json?.error || json?.reason || `HTTP ${response.status}`,
		});
		return { ok: false, error: json?.error || json?.reason || "Porosia e jashtme dështoi." };
	}
	await supabase.from("integration_logs").insert({
		business_id: params.businessId,
		direction: "outbound",
		target: "orders",
		status: "ok",
		error: null,
	});
	return { ok: true, orderId: json.orderId, orderNumber: json.orderNumber };
}
