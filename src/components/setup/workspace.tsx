import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";
import "./workspace.css";

export function SetupWorkspace({ children, name, slug }: { children: React.ReactNode; name: string; slug: string }) {
  return <div className="dashboard-shell setup-workspace">
    <header className="setup-workspace-header">
      <Link href="/" aria-label="Agjenti.app"><BrandLogo size={34} /></Link>
      <div><strong>{name}</strong><span>Onboarding · Përgatitja e biznesit</span></div>
      <Link href={`/b/${slug}`} className="btn btn-ghost">Vazhdo në panel →</Link>
    </header>
    <main className="setup-workspace-content">{children}</main>
  </div>;
}
