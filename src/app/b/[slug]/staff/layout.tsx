import { requireEnabledModule } from "@/lib/dashboard/modules/permissions";
export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  await requireEnabledModule((await params).slug, "staff");
  return children;
}
