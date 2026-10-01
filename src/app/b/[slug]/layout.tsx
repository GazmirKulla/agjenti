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
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/app" className="font-semibold">
            Agjenti · {business.name}
          </Link>
          <nav className="flex flex-wrap gap-3 text-sm">
            {items.map(([path, label]) => (
              <Link key={path} className="text-zinc-600 hover:text-zinc-900" href={`/b/${slug}/${path}`}>
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-6xl p-6">{children}</div>
    </div>
  );
}
