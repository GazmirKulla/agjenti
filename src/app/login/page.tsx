"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";

function LoginForm() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const next = searchParams.get("next") || "/app";
	const [mode, setMode] = useState<"signin" | "signup">("signin");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setMessage(null);
		setBusy(true);
		const supabase = createBrowserSupabase();

		try {
			if (mode === "signin") {
				const { error: err } = await supabase.auth.signInWithPassword({ email, password });
				if (err) {
					setError(err.message);
					return;
				}
			} else {
				const { data, error: err } = await supabase.auth.signUp({ email, password });
				if (err) {
					setError(err.message);
					return;
				}
				// Nëse confirm email është ON, nuk ka session menjëherë.
				if (!data.session) {
					setMessage("Llogaria u krijua. Nëse kërkohet konfirmim, kontrollo email-in — ose fik Confirm email te Supabase.");
					return;
				}
			}

			router.replace(next.startsWith("/") ? next : "/app");
			router.refresh();
		} finally {
			setBusy(false);
		}
	}

	return (
		<main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-8">
			<div>
				<p className="text-sm uppercase tracking-wide text-zinc-500">Agjenti.app</p>
				<h1 className="text-3xl font-semibold">
					{mode === "signin" ? "Hyr në platformë" : "Krijo llogari"}
				</h1>
				<p className="mt-2 text-zinc-600">Stafi i biznesit dhe Platform Admin.</p>
			</div>

			<form onSubmit={onSubmit} className="flex flex-col gap-3">
				<input
					type="email"
					required
					autoComplete="email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="email@biznesi.com"
					className="rounded-lg border border-zinc-300 px-3 py-2"
				/>
				<input
					type="password"
					required
					minLength={6}
					autoComplete={mode === "signin" ? "current-password" : "new-password"}
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					placeholder="Fjalëkalimi"
					className="rounded-lg border border-zinc-300 px-3 py-2"
				/>
				<button
					type="submit"
					disabled={busy}
					className="rounded-lg bg-zinc-900 px-4 py-3 text-white disabled:opacity-60"
				>
					{busy ? "Duke u përpunuar…" : mode === "signin" ? "Hyr" : "Regjistrohu"}
				</button>
			</form>

			<button
				type="button"
				className="text-sm text-zinc-600 underline"
				onClick={() => {
					setMode(mode === "signin" ? "signup" : "signin");
					setError(null);
					setMessage(null);
				}}
			>
				{mode === "signin" ? "Nuk ke llogari? Regjistrohu" : "Ke llogari? Hyr"}
			</button>

			{message ? <p className="text-sm text-green-700">{message}</p> : null}
			{error ? <p className="text-sm text-red-700">{error}</p> : null}
		</main>
	);
}

export default function LoginPage() {
	return (
		<Suspense fallback={<main className="p-8">Duke ngarkuar…</main>}>
			<LoginForm />
		</Suspense>
	);
}
