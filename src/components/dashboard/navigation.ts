export function isDashboardRoute(pathname: string, base: string, path: string) {
  const href = `${base}${path ? `/${path}` : ""}`;
  return path
    ? pathname === href || pathname.startsWith(`${href}/`)
    : pathname === href;
}

export type { NavItem } from "@/lib/dashboard/navigation/builder";
