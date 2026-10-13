"use server";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { invitationHash, validInvitationToken } from "@/lib/actions/provision";
export async function acceptInvitation(form: FormData) {
  const token = String(form.get("request") ?? "");
  if (!validInvitationToken(token))
    return { error: "Ftesa nuk është e vlefshme." };
  const user = await getSessionUser();
  if (!user)
    redirect(`/login?next=${encodeURIComponent(`/join?request=${token}`)}`);
  const { data, error } = await createServiceSupabase().rpc(
    "accept_business_invitation",
    { p_hash: invitationHash(token), p_user: user.id },
  );
  if (error || typeof data !== "string")
    return {
      error: error?.message.includes("recipient_mismatch")
        ? "Hyr me emailin e ftesës dhe konfirmoje atë përpara pranimit."
        : "Ftesa ka skaduar, është anuluar ose biznesi ka tashmë pronar. Kërko një ftesë të re.",
    };
  redirect(`/b/${encodeURIComponent(data)}`);
}
