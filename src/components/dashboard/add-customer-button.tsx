"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AddCustomerButton(props: {
	businessId: string;
	conversationId: string;
}) {
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function addCustomer() {
		if (pending) return;
		setPending(true);
		setError(null);
		try {
			const res = await fetch(
				`/api/businesses/${props.businessId}/conversations/${props.conversationId}/customer`,
				{ method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
			);
			const json = (await res.json()) as { error?: string };
			if (!res.ok) throw new Error(json.error || "Shtimi i klientit dështoi.");
			router.refresh();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Shtimi i klientit dështoi.");
		} finally {
			setPending(false);
		}
	}

	return (
		<div className="mt-4">
			<button
				type="button"
				className="btn btn-primary w-full"
				disabled={pending}
				onClick={() => void addCustomer()}
			>
				{pending ? "Duke shtuar…" : "Shto si klient"}
			</button>
			{error ? <p className="muted-copy mt-2 text-red-600">{error}</p> : null}
		</div>
	);
}
