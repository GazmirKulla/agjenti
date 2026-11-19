"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { acceptMemberInvitation, inviteMember, removeMember, revokeInvitation, setMemberRole, TeamError } from "./service";

type Result = { error?: string; success?: string; link?: string | null };
async function owner(slug: string) {
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access) throw new TeamError("Nuk ke qasje në këtë biznes.");
  return { userId: user.id, businessId: access.business.id, slug: access.business.slug };
}
const run = async (slug: string, work: (a: Awaited<ReturnType<typeof owner>>) => Promise<Result>): Promise<Result> => {
  try { const a = await owner(slug); const result = await work(a); revalidatePath(`/admin/businesses/${a.businessId}/team`); return result; }
  catch (error) { return { error: error instanceof TeamError ? error.message : "Veprimi nuk u krye. Provo përsëri." }; }
};

export async function inviteTeamMember(slug: string, email: string, role: string): Promise<Result> {
  return run(slug, async a => {
    const invited = await inviteMember(a.businessId, a.userId, { email, role });
    return { success: `Ftesa për ${invited.email} u krijua. Kopjoje lidhjen dhe dërgoja; vlen 7 ditë.`, link: invited.link };
  });
}
export async function revokeTeamInvitation(slug: string, id: string): Promise<Result> {
  return run(slug, async a => { await revokeInvitation(a.businessId, a.userId, id); return { success: "Ftesa u anulua." }; });
}
export async function removeTeamMember(slug: string, memberId: string): Promise<Result> {
  return run(slug, async a => { await removeMember(a.businessId, a.userId, memberId); return { success: "Anëtari u hoq nga biznesi." }; });
}
export async function changeTeamRole(slug: string, memberId: string, role: string): Promise<Result> {
  return run(slug, async a => { await setMemberRole(a.businessId, a.userId, memberId, role); return { success: "Roli u ndryshua." }; });
}
export async function acceptTeamInvitation(form: FormData): Promise<Result> {
  const token = String(form.get("token") ?? "");
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/team/join?token=${token}`)}`);
  let slug: string | null;
  try { slug = await acceptMemberInvitation(token, user.id); }
  catch (error) { return { error: error instanceof TeamError ? error.message : "Ftesa nuk u pranua. Provo përsëri." }; }
  redirect(slug ? `/b/${encodeURIComponent(slug)}` : "/auth/continue");
}
