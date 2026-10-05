export function isDashboardRoute(pathname: string, base: string, path: string) {
  const href = `${base}${path ? `/${path}` : ""}`;
  return path
    ? pathname === href || pathname.startsWith(`${href}/`)
    : pathname === href;
}
export const mobileBusinessNav = [
  ["", "Kreu", "dashboard"],
  ["inbox", "Inbox", "inbox"],
  ["products", "Produkte", "products"],
  ["orders", "Porosi", "orders"],
];
export const mobileAdminNav = [
  ["", "Kreu", "dashboard"],
  ["businesses", "Bizneset", "businesses"],
  ["conversations", "Bisedat", "inbox"],
  ["app", "App", "settings"],
];
