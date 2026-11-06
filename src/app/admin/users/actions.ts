"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { restoreAccountDeletion } from "@/lib/account/deletion";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function manageUser(form: FormData) {
  const actor = await getSessionUser();
  if (!actor || !(await isPlatformAdmin(actor.id))) return { error: "Kërkohet qasja e administratorit të platformës." };
  const action = String(form.get("action") ?? "");
  if (!["create", "password", "verify_email", "restore"].includes(action)) return { error: "Veprim i pavlefshëm." };
  const password = String(form.get("password") ?? "");
  const needsPassword = action === "create" || action === "password";
  if (needsPassword && (password.length < 8 || password.length > 128)) return { error: "Fjalëkalimi duhet të ketë 8–128 karaktere." };
  if (needsPassword && password !== String(form.get("password_confirm") ?? "")) return { error: "Fjalëkalimet nuk përputhen." };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const name = String(form.get("name") ?? "").trim();
  const businessId = String(form.get("business_id") ?? "");
  const role = String(form.get("role") ?? "staff");
  if (action === "create" && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !name || name.length > 150)) return { error: "Vendos një emër dhe email të vlefshëm." };
  if (action === "create" && businessId && (!uuid.test(businessId) || !["owner", "staff"].includes(role))) return { error: "Biznesi ose roli është i pavlefshëm." };
  const targetId = action === "create" ? randomUUID() : String(form.get("user_id") ?? "");
  if (!uuid.test(targetId)) return { error: "Përdorues i pavlefshëm." };
  const db = createServiceSupabase();
  if (action === "create" && businessId) {
    const { data, error } = await db.from("businesses").select("id").eq("id", businessId).maybeSingle();
    if (error || !data) return { error: "Biznesi nuk u gjet. Rifresko faqen." };
  }
  // Write the intent before touching Auth. Never include submitted form data or credentials.
  const { data: receipt, error: auditError } = await db.from("platform_user_events").insert({ actor_id: actor.id, target_id: targetId, action }).select("id").single();
  if (auditError || !receipt) return { error: "Historia administrative nuk është e disponueshme. Veprimi nuk u krye." };
  const result = action === "create"
    ? await db.auth.admin.createUser({ id: targetId, email, password, email_confirm: form.get("verified") === "on", user_metadata: { full_name: name } })
    : action === "restore"
      ? await restoreAccountDeletion(targetId)
      : await db.auth.admin.updateUserById(targetId, action === "password" ? { password } : { email_confirm: true });
  const { error: receiptError } = await db.from("platform_user_events").update({ status: result.error ? "failed" : "completed" }).eq("id", receipt.id);
  if (result.error) {
    const code = result.error.code;
    return { error: code === "email_exists" || code === "user_already_exists"
      ? "Ky email ka tashmë një llogari. Kërko përdoruesin në listë."
      : code === "weak_password" ? "Fjalëkalimi nuk përmbush kërkesat e sigurisë. Zgjidh një më të fortë."
      : code === "not_scheduled" ? "Kjo llogari nuk ka fshirje në pritje ose fshirja përfundimtare ka filluar. Rifresko faqen."
      : "Veprimi nuk u krye. Kontrollo të dhënat dhe provo përsëri." };
  }
  let membershipFailed = false;
  if (action === "create" && businessId) {
    const { error } = await db.from("business_users").insert({ business_id: businessId, user_id: targetId, role });
    membershipFailed = Boolean(error);
    revalidatePath("/admin/businesses");
  }
  revalidatePath("/admin/users");
  if (membershipFailed) return { error: "Llogaria u krijua, por lidhja me biznesin dështoi. Shto anëtarin nga seksioni Bizneset; mos e krijo llogarinë përsëri." };
  if (receiptError) return { error: "Ndryshimi u krye, por konfirmimi në histori dështoi. Rifresko faqen përpara se të përsëritësh veprimin." };
  return { success: action === "create" ? "Përdoruesi u krijua pa dërguar email ftese." : action === "password" ? "Fjalëkalimi u ndryshua." : action === "restore" ? "Llogaria u rikthye dhe fshirja u anulua." : "Email-i u verifikua manualisht." };
}
