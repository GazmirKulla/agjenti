import "@/components/catalogs/catalogs.css";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className="catalog-workspace">{children}</div>;
}
