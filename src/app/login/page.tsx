"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";

function LoginForm() {
	const searchParams = useSearchParams();
	const [email, setEmail] = useState("");
	const [sent, setSent] = useState(false);
	const [error, setError] = useState<string | null>(
		searchParams.get("error") === "oauth_callback"
			? "Nuk u finalizua hyrja. Hap lidhjen e email-it në të njëjtin browser ku kërkove login, ose provo Google."
			: null,
	);

	async function signInGoogle() {
		setError(null);
		const supabase = createBrowserSupabase();
		const origin = window.location.origin;
		const { error: err } = await supabase.auth.signInWithOAuth({
			provider: "google",
			options: { redirectTo: `${origin}/auth/callback` },
		});
		if (err) setError(err.message);
	}

	async function signInEmail(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		const supabase = createBrowserSupabase();
		const { error: err } = await supabase.auth.signInWithOtp({
			email,
			options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
		});
		if (err) setError(err.message);
		else setSent(true);
	}

	return (
		<main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-8">
			<div>
				<p className="text-sm uppercase tracking-wide text-zinc-500">Agjenti.app</p>
				<h1 className="text-3xl font-semibold">Hyr në platformë</h1>
				<p className="mt-2 text-zinc-600">Stafi i biznesit dhe Platform Admin.</p>
			</div>
			<button
				type="button"
				onClick={signInGoogle}
				className="rounded-lg bg-zinc-900 px-4 py-3 text-white"
			>
				Vazhdo me Google
			</button>
			<form onSubmit={signInEmail} className="flex flex-col gap-3">
				<input
					type="email"
					required
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="email@biznesi.com"
					className="rounded-lg border border-zinc-300 px-3 py-2"
				/>
				<button type="submit" className="rounded-lg border border-zinc-300 px-4 py-2">
					Dërgo lidhjen e hyrjes
				</button>
			</form>
			{sent ? (
				<p className="text-sm text-green-700">
					Kontrollo email-in. Hap lidhjen në të njëjtin browser ku je tani.
				</p>
			) : null}
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
