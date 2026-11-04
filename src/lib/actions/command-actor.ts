import { getSessionUser, requireBusinessAccess, type BusinessRow } from "@/lib/tenant/access";
/** Constructed only at an authenticated server boundary, never from client inputs. */
export type CommandActor = { userId: string; business: BusinessRow };
export async function manualCommandActor(slug: string): Promise<CommandActor> {
  const user = await getSessionUser();
  if (!user) throw Error("Sesioni ka skaduar. Hyr përsëri.");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) throw Error("Nuk ke qasje në këtë biznes.");
  return { userId: user.id, business: { ...access.business, slug: access.business.slug ?? slug } };
}
