"use client";

import Link from "next/link";
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
				if (!data.session) {
					setMessage(
						"Llogaria u krijua. Nëse kërkohet konfirmim, kontrollo email-in — ose fik Confirm email te Supabase.",
					);
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
		<main className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
			<div className="fade-up mb-8">
				<Link href="/" className="brand-mark text-3xl text-ink">
					Agjenti
				</Link>
				<h1 className="mt-6 text-2xl text-ink">
					{mode === "signin" ? "Hyr në platformë" : "Krijo llogari"}
				</h1>
				<p className="mt-2 text-ink-muted">Stafi i biznesit dhe Platform Admin.</p>
			</div>

			<form onSubmit={onSubmit} className="fade-up-delay flex flex-col gap-3">
				<label className="grid gap-1.5 text-sm text-ink-muted">
					Email
					<input
						type="email"
						required
						autoComplete="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						placeholder="email@biznesi.com"
						className="field"
					/>
				</label>
				<label className="grid gap-1.5 text-sm text-ink-muted">
					Fjalëkalimi
					<input
						type="password"
						required
						minLength={6}
						autoComplete={mode === "signin" ? "current-password" : "new-password"}
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						placeholder="••••••••"
						className="field"
					/>
				</label>
				<button type="submit" disabled={busy} className="btn btn-primary mt-2">
					{busy ? "Duke u përpunuar…" : mode === "signin" ? "Hyr" : "Regjistrohu"}
				</button>
			</form>

			<button
				type="button"
				className="fade-up-delay-2 mt-5 text-left text-sm text-ink-muted underline decoration-line underline-offset-4 hover:text-ink"
				onClick={() => {
					setMode(mode === "signin" ? "signup" : "signin");
					setError(null);
					setMessage(null);
				}}
			>
				{mode === "signin" ? "Nuk ke llogari? Regjistrohu" : "Ke llogari? Hyr"}
			</button>

			{message ? <p className="mt-4 text-sm text-success">{message}</p> : null}
			{error ? (
				<p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
			) : null}
		</main>
	);
}

export default function LoginPage() {
	return (
		<Suspense fallback={<main className="p-8 text-ink-muted">Duke ngarkuar…</main>}>
			<LoginForm />
		</Suspense>
	);
}
