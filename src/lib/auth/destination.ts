export function homeForAccess(access: {
  admin: boolean;
  businesses: { slug: string }[];
}) {
  if (access.admin) return "/admin";
  return access.businesses.length
    ? `/b/${encodeURIComponent(access.businesses[0].slug)}`
    : "/account";
}
