import Link from "next/link";

export default function HomePage() {
	return (
		<main className="relative min-h-screen overflow-hidden">
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 opacity-[0.35]"
				style={{
					backgroundImage:
						"linear-gradient(rgb(19 35 28 / 5%) 1px, transparent 1px), linear-gradient(90deg, rgb(19 35 28 / 5%) 1px, transparent 1px)",
					backgroundSize: "48px 48px",
					maskImage: "radial-gradient(ellipse 70% 55% at 50% 30%, black, transparent)",
				}}
			/>

			<div className="relative mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16 md:px-10">
				<p className="brand-mark fade-up text-4xl text-ink md:text-6xl lg:text-7xl">Agjenti</p>
				<h1 className="fade-up-delay mt-6 max-w-2xl text-2xl font-semibold text-ink md:text-3xl">
					Suport me AI për shumë biznese
				</h1>
				<p className="fade-up-delay-2 mt-4 max-w-xl text-base leading-relaxed text-ink-muted md:text-lg">
					Lidh Instagram, merri bisedat në një inbox, dhe dërgo porositë te faqja e biznesit.
				</p>
				<div className="fade-up-delay-2 mt-8 flex flex-wrap items-center gap-3">
					<Link href="/login" className="btn btn-primary">
						Hyr
					</Link>
					<span className="text-sm text-ink-muted">agjenti.app</span>
				</div>
			</div>
		</main>
	);
}
