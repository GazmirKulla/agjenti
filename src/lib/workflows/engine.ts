export const PUZZLE_STEPS = [
	{ key: "collect_theme", kind: "text" as const, label: "Personazhi" },
	{ key: "awaiting_confirm", kind: "confirm" as const, label: "Konfirmim" },
	{ key: "awaiting_photo", kind: "photo" as const, label: "Foto" },
	{ key: "collect_size", kind: "choice" as const, label: "Madhësi" },
	{ key: "collect_pieces", kind: "choice" as const, label: "Copëza" },
	{ key: "collect_age", kind: "text" as const, label: "Mosha" },
	{ key: "collect_tray", kind: "confirm" as const, label: "Tabaka" },
	{ key: "collect_customer", kind: "customer" as const, label: "Adresa" },
];

export const APPAREL_STEPS = [
	{ key: "collect_size", kind: "choice" as const, label: "Madhësi" },
	{ key: "collect_color", kind: "choice" as const, label: "Ngjyra" },
	{ key: "collect_customer", kind: "customer" as const, label: "Adresa" },
];

export const SIMPLE_STEPS = [
	{ key: "confirm_product", kind: "confirm" as const, label: "Konfirmim" },
	{ key: "collect_customer", kind: "customer" as const, label: "Adresa" },
];

export type WorkflowStepKind = "choice" | "text" | "photo" | "customer" | "confirm";

export type ConversationStatePayload = {
	product_id?: string | null;
	product_type_id?: string | null;
	step_key?: string | null;
	fields: Record<string, unknown>;
	customer: {
		name: string | null;
		phone: string | null;
		city: string | null;
		address: string | null;
	};
};

export function emptyState(): ConversationStatePayload {
	return {
		product_id: null,
		product_type_id: null,
		step_key: "choose_product",
		fields: {},
		customer: { name: null, phone: null, city: null, address: null },
	};
}

export function nextStepKey(
	current: string | null | undefined,
	steps: { key: string }[],
): string | null {
	if (!current || current === "choose_product") {
		return steps[0]?.key ?? "collect_customer";
	}
	const idx = steps.findIndex((step) => step.key === current);
	if (idx < 0) return steps[0]?.key ?? null;
	return steps[idx + 1]?.key ?? "order_ready";
}

export function applyInboundToState(
	state: ConversationStatePayload,
	text: string,
	hasPhoto: boolean,
	steps: { key: string; kind: WorkflowStepKind }[],
): ConversationStatePayload {
	const next = { ...state, fields: { ...state.fields }, customer: { ...state.customer } };
	const trimmed = text.trim();
	if (!next.product_id && trimmed) {
		next.fields.product_query = trimmed;
		next.step_key = steps[0]?.key ?? "collect_customer";
		return next;
	}
	const key = next.step_key ?? steps[0]?.key;
	const step = steps.find((item) => item.key === key);
	if (!step) {
		next.step_key = "order_ready";
		return next;
	}
	if (step.kind === "photo" && hasPhoto) {
		next.fields.photo = true;
		next.step_key = nextStepKey(step.key, steps);
		return next;
	}
	if (step.kind === "customer") {
		if (!next.customer.name) next.customer.name = trimmed || next.customer.name;
		else if (!next.customer.phone) next.customer.phone = trimmed || next.customer.phone;
		else if (!next.customer.city) next.customer.city = trimmed || next.customer.city;
		else if (!next.customer.address) next.customer.address = trimmed || next.customer.address;
		if (next.customer.name && next.customer.phone && next.customer.city && next.customer.address) {
			next.step_key = "order_ready";
		}
		return next;
	}
	if (trimmed) {
		next.fields[step.key] = trimmed;
		next.step_key = nextStepKey(step.key, steps);
	}
	return next;
}

export function promptForStep(stepKey: string | null | undefined): string {
	switch (stepKey) {
		case "choose_product":
			return "Cilin produkt dëshironi?";
		case "collect_theme":
			return "Cilin personazh ose temë doni në produkt?";
		case "awaiting_confirm":
			return "A e konfirmoni këtë zgjedhje?";
		case "awaiting_photo":
			return "Na dërgoni foton që do të përdorim.";
		case "collect_size":
			return "Çfarë madhësie doni?";
		case "collect_pieces":
			return "Sa copëza doni?";
		case "collect_age":
			return "Sa vjeç është fëmija?";
		case "collect_tray":
			return "A doni tabaka?";
		case "collect_color":
			return "Çfarë ngjyre doni?";
		case "collect_customer":
			return "Na jepni emrin, telefonin, qytetin dhe adresën.";
		case "confirm_product":
			return "A e konfirmoni porosinë e këtij produkti?";
		case "order_ready":
			return "Porosia është gati. Stafi ose agjenti mund ta konfirmojë.";
		default:
			return "Si mund t'ju ndihmoj?";
	}
}
