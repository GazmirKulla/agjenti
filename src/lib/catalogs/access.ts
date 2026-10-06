import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
export async function catalogAccess(slug: string) {
  const user = await getSessionUser();
  if (!user) throw new Error("unauthorized");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) throw new Error("unauthorized");
  return access;
}
