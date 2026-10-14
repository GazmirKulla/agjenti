"use server";
import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import {
  getSessionUser,
  isPlatformAdmin,
  requireBusinessAccess,
} from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { encryptSecret } from "@/lib/crypto/tokens";
import { isActionKey } from "./catalog";
import { isPolicyKey } from "./policies";
import { provisionBusiness, invitationHash } from "./provision";
const text = (form: FormData, key: string) => String(form.get(key) ?? "");
export async function saveActionPolicy(form: FormData) {
  try {
    const user = await getSessionUser();
    if (!user || !(await isPlatformAdmin(user.id)))
      throw new Error("Kërkohet administratori i platformës.");
    const key = text(form, "action_key"),
      scope = text(form, "scope"),
      target = text(form, "target");
    if (!isPolicyKey(key)) throw new Error("Veprim i pavlefshëm.");
    const raw = text(form, "monthly_limit"),
      limit = raw === "" ? null : Number(raw);
    if (limit !== null && (!Number.isSafeInteger(limit) || limit < 0))
      throw new Error("Kufiri duhet të jetë numër i plotë pozitiv ose zero.");
    const mode = form.get("checkbox_mode") === "true" && form.get("enabled") === null ? "false" : text(form, "enabled");
    if (!["true", "false", "inherit"].includes(mode))
      throw new Error("Zgjedhje e pavlefshme.");
    const enabled = mode === "inherit" ? null : mode === "true";
    const db = createServiceSupabase();
    const table =
      scope === "global"
        ? "platform_actions"
        : scope === "plan"
          ? "plan_actions"
          : scope === "business"
            ? "business_actions"
            : null;
    if (!table || (scope !== "business" && enabled === null))
      throw new Error("Konfigurim i pavlefshëm.");
    const expiresRaw = text(form, "expires_at");
    if (expiresRaw && !/^\d{4}-\d{2}-\d{2}$/.test(expiresRaw))
      throw new Error("Data nuk është e vlefshme.");
    const expires = expiresRaw || null;
    const { error } = await db.rpc("save_action_policy", {
      p_user: user.id,
      p_scope: scope,
      p_target: target,
      p_action: key,
      p_enabled: enabled,
      p_limit: limit,
      p_expires: expires,
    });
    if (error)
      throw new Error("Politika nuk u ruajt. Kontrollo migrimin dhe vlerat.");
    revalidatePath("/admin/actions");
    if (scope === "business") revalidatePath(`/admin/businesses/${target}/permissions`);
    revalidatePath("/b/[slug]", "layout");
    return { success: "Politika u ruajt." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Ruajtja dështoi." };
  }
}
/** Save the package list through the existing audited policy operation. */
export async function saveModulePackages(form: FormData) {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) return { error: "Kërkohet administratori i platformës." };
  const key = text(form, "action_key");
  if (!isPolicyKey(key)) return { error: "Veprim i pavlefshëm." };
  const packages = ["free", "starter", "professional", "enterprise"];
  const updates = packages.map(plan => {
    const data = new FormData();
    data.set("action_key", key); data.set("scope", "plan"); data.set("target", plan);
    data.set("enabled", form.get(`plan_${plan}`) === "on" ? "true" : "false");
    data.set("monthly_limit", text(form, `limit_${plan}`));
    return data;
  });
  // Validate all limits before the first write.
  if (updates.some(data => {
    const raw = text(data, "monthly_limit");
    return raw !== "" && (!Number.isSafeInteger(Number(raw)) || Number(raw) < 0);
  })) return { error: "Kufijtë duhet të jenë numra të plotë pozitivë ose zero." };
  for (const data of updates) {
    const result = await saveActionPolicy(data);
    if (result.error) return { error: `Ruajtja nuk u përfundua për ${text(data, "target")}. Disa paketa mund të jenë ruajtur. Provo përsëri. ${result.error}` };
  }
  return { success: "Paketat u ruajtën." };
}

export async function saveBusinessActionSettings(slug: string, form: FormData) {
  try {
    const user = await getSessionUser(),
      access = user ? await requireBusinessAccess(user.id, slug) : null;
    if (!user || !access) throw new Error("Nuk ke qasje.");
    const db = createServiceSupabase();
    const { data: member } = await db
      .from("business_users")
      .select("role")
      .eq("business_id", access.business.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!access.admin && member?.role !== "owner")
      throw new Error("Vetëm pronari konfiguron lejet.");
    const key = text(form, "action_key"),
      days = Number(form.get("invitation_days") ?? 7);
    if (!isActionKey(key) || !Number.isInteger(days) || days < 1 || days > 30)
      throw new Error("Konfigurim i pavlefshëm.");
    const existing = await db.from("business_action_settings").select("staff_allowed")
      .eq("business_id", access.business.id).eq("action_key", key).maybeSingle();
    if (existing.error) throw new Error("Nuk u ngarkua konfigurimi ekzistues.");
    const { error } = await db.rpc("save_business_action_settings", {
      p_business: access.business.id,
      p_user: user.id,
      p_action: key,
      p_staff: existing.data?.staff_allowed ?? key !== "business.provision",
      p_automation:
        key === "business.provision" && form.get("automation_allowed") === "on",
      p_days: days,
    });
    if (error) throw new Error("Konfigurimi nuk u ruajt.");
    revalidatePath(`/b/${slug}/actions`);
    return { success: "Konfigurimi u ruajt." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Ruajtja dështoi." };
  }
}
export async function prepareBusiness(slug: string, form: FormData) {
  try {
    const user = await getSessionUser(),
      access = user ? await requireBusinessAccess(user.id, slug) : null;
    if (!user || !access) throw new Error("Nuk ke qasje.");
    const requestId = text(form, "request_id");
    if (!/^[0-9a-f-]{36}$/.test(requestId))
      throw new Error("Rifresko kërkesën.");
    const result = await provisionBusiness({
      businessId: access.business.id,
      userId: user.id,
      requestId: `manual:${requestId}`,
      input: {
        name: text(form, "name"),
        email: text(form, "email"),
        description: text(form, "description"),
      },
    });
    revalidatePath(`/b/${slug}/actions`);
    return {
      success: "Biznesi u përgatit. Ftesa është gati për dërgim.",
      ...result,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Krijimi dështoi." };
  }
}
export async function changeInvitation(slug: string, form: FormData) {
  try {
    const user = await getSessionUser(),
      access = user ? await requireBusinessAccess(user.id, slug) : null;
    if (!user || !access) throw new Error("Nuk ke qasje.");
    const token = randomBytes(32).toString("base64url");
    const { error } = await createServiceSupabase().rpc(
      "rotate_business_invitation",
      {
        p_id: text(form, "invitation_id"),
        p_source: access.business.id,
        p_user: user.id,
        p_hash: invitationHash(token),
        p_ciphertext: encryptSecret(token),
        p_revoke: form.get("operation") === "revoke",
      },
    );
    if (error)
      throw new Error("Ftesa nuk u ndryshua. Mund të jetë pranuar ndërkohë.");
    revalidatePath(`/b/${slug}/actions`);
    return { success: "Ftesa u përditësua." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Veprimi dështoi." };
  }
}
