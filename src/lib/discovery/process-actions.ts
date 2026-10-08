"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { parseBusinessProcess } from "./business-process";
export async function saveBusinessProcess(slug: string, revision: number, raw: unknown) {
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access) return { error: "Nuk ke qasje në këtë biznes." };
  if (!Number.isInteger(revision) || revision < 0) return { error: "Versioni nuk është i vlefshëm. Rifresko faqen." };
  const process = parseBusinessProcess(raw, true);
  if (!process) return { error: "Plotëso emrin, përshkrimin dhe të paktën një hap të rrjedhës." };
  const result = await createServiceSupabase().rpc("save_business_process", { p_business: access.business.id, p_user: user.id, p_revision: revision, p_process: process });
  if (result.error) return { error: result.error.message === "stale_process" ? "Rrjedha ndryshoi ndërkohë. Rifresko faqen para se ta ruash." : ["PGRST202", "42883"].includes(result.error.code) ? "Ruajtja kërkon migrimin 20261008160000_business_process.sql në databazë." : "Rrjedha nuk u ruajt. Provo përsëri." };
  revalidatePath(`/b/${slug}`, "layout");
  return { process, revision: result.data as number };
}
