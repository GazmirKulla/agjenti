import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

export default async function BusinessLayout({
	children,
	params,
}: {
	children: React.ReactNode;
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const user = await getSessionUser();
	if (!user) redirect("/login");
	const access = await requireBusinessAccess(user.id, slug);
	if (!access) redirect("/app");
	const { business } = access;
	const items = [
		["inbox", "Inbox"],
		["instagram", "Instagram"],
		["products", "Produkte"],
		["workflows", "Workflow"],
		["knowledge", "Njohuri"],
		["agents", "Agjentët"],
		["orders", "Porosi"],
		["settings", "Cilësimet"],
	] as const;

	return (
		<div className="min-h-screen">
			<header className="sticky top-0 z-20 border-b border-line/80 bg-surface/80 backdrop-blur-md">
				<div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-4 md:px-6">
					<div className="flex items-center justify-between gap-4">
						<Link href="/app" className="min-w-0">
							<span className="brand-mark text-lg text-ink">Agjenti</span>
							<span className="mt-0.5 block truncate text-sm text-ink-muted">{business.name}</span>
						</Link>
					</div>
					<nav className="flex flex-wrap gap-x-4 gap-y-1">
						{items.map(([path, label]) => (
							<Link key={path} className="nav-link" href={`/b/${slug}/${path}`}>
								{label}
							</Link>
						))}
					</nav>
				</div>
			</header>
			<div className="mx-auto max-w-6xl px-5 py-6 md:px-6">{children}</div>
		</div>
	);
}
