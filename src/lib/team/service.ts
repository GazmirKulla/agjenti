import { randomBytes } from "node:crypto";
import { createServiceSupabase } from "@/lib/supabase/service";
import { encryptSecret, decryptSecret } from "@/lib/crypto/tokens";
import { invitationHash, validInvitationToken } from "@/lib/actions/provision";
import { isPlatformAdmin } from "@/lib/tenant/access";

/**
 * The business's team: members with a role (owner or staff) and the invitations waiting. An owner invites
 * by email; the invitation is a link the owner shares and only the invited, confirmed email accepts it.
 */
export type TeamRole = "owner" | "staff";
export type TeamMember = { userId: string; email: string | null; name: string | null; role: TeamRole; since: string; you: boolean };
export type TeamInvitation = { id: string; email: string; role: TeamRole; expiresAt: string; link: string | null };
export class TeamError extends Error {}

const INVITE_DAYS = 7;
const emailOf = (value: unknown) => {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email.length <= 254 ? email : null;
};
function appOrigin() {
  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  return origin && /^https?:\/\//.test(origin) ? origin : null;
}
const linkFor = (token: string) => { const origin = appOrigin(); return origin ? `${origin}/team/join?token=${token}` : null; };

export async function isOwner(businessId: string, userId: string) {
  const { data } = await createServiceSupabase().from("business_users").select("role").eq("business_id", businessId).eq("user_id", userId).maybeSingle();
  return data?.role === "owner" || await isPlatformAdmin(userId);
}

export async function loadTeam(businessId: string, userId: string): Promise<{ members: TeamMember[]; invitations: TeamInvitation[]; owner: boolean }> {
  const db = createServiceSupabase();
  const [members, invitations, owner] = await Promise.all([
    db.from("business_users").select("user_id,role,created_at,profiles(email,display_name)").eq("business_id", businessId).order("created_at"),
    db.from("business_member_invitations").select("id,email,role,expires_at,token_ciphertext").eq("business_id", businessId).eq("status", "pending")
      .gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }),
    isOwner(businessId, userId),
  ]);
  if (members.error) throw new TeamError("Ekipi nuk u lexua.");
  return {
    owner,
    members: (members.data ?? []).map(row => {
      const profile = row.profiles as unknown as { email: string | null; display_name: string | null } | null;
      return { userId: row.user_id, email: profile?.email ?? null, name: profile?.display_name ?? null, role: row.role as TeamRole, since: row.created_at, you: row.user_id === userId };
    }),
    // Before the team migration the invitations cannot be read; the members still show.
    invitations: invitations.error ? [] : (invitations.data ?? []).map(row => ({ id: row.id, email: row.email, role: row.role as TeamRole, expiresAt: row.expires_at,
      link: owner ? (() => { try { return linkFor(decryptSecret(row.token_ciphertext)); } catch { return null; } })() : null })),
  };
}

/** A new invitation (or a fresh link for the same email): owners only; not for someone already in the team. */
export async function inviteMember(businessId: string, userId: string, input: { email: unknown; role: unknown }) {
  if (!(await isOwner(businessId, userId))) throw new TeamError("Vetëm pronari fton anëtarë.");
  const email = emailOf(input.email);
  if (!email) throw new TeamError("Shkruaj një email të vlefshëm.");
  if (input.role !== "owner" && input.role !== "staff") throw new TeamError("Zgjidh rolin: pronar ose staf.");
  const db = createServiceSupabase();
  const { data: existing } = await db.from("business_users").select("user_id,profiles!inner(email)").eq("business_id", businessId).eq("profiles.email", email).maybeSingle();
  if (existing) throw new TeamError("Ky person është tashmë në ekip.");
  await db.from("business_member_invitations").update({ status: "revoked" }).eq("business_id", businessId).eq("email", email).eq("status", "pending");
  const token = randomBytes(32).toString("base64url");
  const { error } = await db.from("business_member_invitations").insert({ business_id: businessId, email, role: input.role, token_hash: invitationHash(token),
    token_ciphertext: encryptSecret(token), invited_by: userId, expires_at: new Date(Date.now() + INVITE_DAYS * 86400000).toISOString() });
  if (error) throw new TeamError("Ftesa nuk u krijua. Provo përsëri.");
  return { email, link: linkFor(token) };
}

export async function revokeInvitation(businessId: string, userId: string, invitationId: string) {
  if (!(await isOwner(businessId, userId))) throw new TeamError("Vetëm pronari anulon ftesat.");
  const { error } = await createServiceSupabase().from("business_member_invitations").update({ status: "revoked" })
    .eq("business_id", businessId).eq("id", invitationId).eq("status", "pending");
  if (error) throw new TeamError("Ftesa nuk u anulua.");
}

const errors: Record<string, string> = { last_owner: "Biznesi duhet të ketë të paktën një pronar.", unauthorized: "Vetëm pronari e ndryshon ekipin.", invalid_role: "Rol i pavlefshëm." };
const rpcError = (message: string) => new TeamError(Object.entries(errors).find(([code]) => message.includes(code))?.[1] ?? "Ndryshimi nuk u ruajt. Provo përsëri.");
export async function removeMember(businessId: string, userId: string, memberId: string) {
  const { error } = await createServiceSupabase().rpc("remove_business_member", { p_business: businessId, p_user: userId, p_member: memberId });
  if (error) throw rpcError(error.message);
}
export async function setMemberRole(businessId: string, userId: string, memberId: string, role: unknown) {
  const { error } = await createServiceSupabase().rpc("set_business_member_role", { p_business: businessId, p_user: userId, p_member: memberId, p_role: role });
  if (error) throw rpcError(error.message);
}

/** Accepting a link: the signed-in person with the invited, confirmed email joins; returns the business slug. */
export async function acceptMemberInvitation(token: string, userId: string) {
  if (!validInvitationToken(token)) throw new TeamError("Ftesa nuk është e vlefshme.");
  const db = createServiceSupabase();
  const { data, error } = await db.rpc("accept_business_member_invitation", { p_token_hash: invitationHash(token), p_user: userId });
  if (error || typeof data !== "string") throw new TeamError(error?.message.includes("email_mismatch")
    ? "Hyr me emailin ku u dërgua ftesa (dhe konfirmoje emailin) para se ta pranosh."
    : error?.message.includes("expired") ? "Ftesa ka skaduar. Kërko një të re." : "Ftesa nuk është më e vlefshme. Kërko një të re.");
  const { data: business } = await db.from("businesses").select("slug").eq("id", data).maybeSingle();
  return business?.slug ?? null;
}
