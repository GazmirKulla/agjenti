import { suggestCampaignCopy } from "@/lib/campaigns/draft";
import { workerOrigin } from "@/lib/discovery/continue";
import { after } from "next/server";
import { transportAccess, isTransportId } from "@/lib/conversations/transport-access";
import { parseCampaign, reasonLabels } from "@/lib/campaigns/model";
import { loadCampaign, loadCampaigns } from "@/lib/campaigns/service";
import { reviewMarketingPreference } from "@/lib/campaigns/preference";
import { continueCampaigns } from "@/lib/campaigns/worker";
import { isIsolatedExecution } from "@/lib/runtime/execution-context";
export const runtime = "nodejs";
export const maxDuration = 120;
const fail = (error: unknown, status = 400) => {
  const code = error instanceof Error ? error.message : "unavailable";
  return Response.json({ error: reasonLabels[code] ?? "Veprimi nuk u krye. Rifresko dhe provo përsëri." }, { status });
};
export async function GET(request: Request) {
  const url = new URL(request.url), businessId = url.searchParams.get("businessId") ?? "", id = url.searchParams.get("id");
  const access = await transportAccess(businessId, request);
  if (!access) return Response.json({ error: "Nuk ke qasje." }, { status: 403 });
  try {
    if (id && !isTransportId(id)) return fail(new Error("invalid_input"));
    return Response.json(id ? await loadCampaign(businessId, id) : await loadCampaigns(businessId));
  } catch (e) { return fail(e, 503); }
}
export async function POST(request: Request) {
  try {
    if (isIsolatedExecution()) return fail(new Error("forbidden"), 403);
    if (Number(request.headers.get("content-length") ?? 0) > 16000) return fail(new Error("invalid_input"));
    const raw = await request.text();
    if (raw.length > 16000) return fail(new Error("invalid_input"));
    const value = JSON.parse(raw);
    const access = await transportAccess(value.businessId, request);
    if (!access) return fail(new Error("forbidden"), 403);
    const member = await access.db.from("business_users").select("role").eq("business_id", value.businessId).eq("user_id", access.userId).maybeSingle();
    if (member.error || !member.data) return fail(new Error("forbidden"), 403);
    if (value.action === "suggest") return Response.json({ variants: await suggestCampaignCopy(value.businessId, value.input?.body, value.input?.terms) });
    if (value.action === "prepare") {
      const input = parseCampaign(value.input);
      const draft = await access.db.rpc("prepare_marketing_campaign", { p_business: value.businessId, p_user: access.userId, p_input: input });
      if (draft.error) throw new Error(draft.error.message);
      return Response.json(await loadCampaign(value.businessId, draft.data));
    }
    if (member.data.role !== "owner") return fail(new Error("owner_required"), 403);
    if (value.action === "review") {
      if (!isTransportId(value.id)) throw new Error("invalid_input");
      // The owner requests interpretation of actual inbound evidence, never grants consent by assertion.
      const latest = await access.db.from("messages").select("id").eq("business_id", value.businessId).eq("conversation_id", value.id).eq("direction", "inbound").eq("source", "customer").not("marketing_inbound_at", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (latest.error || !latest.data) throw new Error("invalid_input");
      const decision = await reviewMarketingPreference(value.businessId, latest.data.id);
      return Response.json({ decision: decision?.decision ?? "unavailable" });
    }
    if (!["confirm", "pause", "resume", "cancel", "settings", "unsubscribe"].some(x => x === value.action)) throw new Error("invalid_input");
    if (value.action !== "settings" && !isTransportId(value.id)) throw new Error("invalid_input");
    if (value.action === "settings" && (typeof value.input?.enabled !== "boolean" || typeof value.input?.timezone !== "string" || !Number.isInteger(value.input?.frequencyDays) || value.input.frequencyDays < 1 || value.input.frequencyDays > 365)) throw new Error("invalid_input");
    if (value.action === "confirm" && (!Number.isInteger(value.input?.count) || value.input.count < 1 || value.input.count > 500)) throw new Error("invalid_input");
    if ((value.action === "confirm" || value.action === "resume") && (!process.env.CRON_SECRET?.trim() || !workerOrigin())) throw new Error("worker_unavailable");
    const result = await access.db.rpc("manage_marketing", { p_business: value.businessId, p_user: access.userId, p_action: value.action, p_id: value.id ?? null, p_input: value.input ?? {} });
    if (result.error) throw new Error(result.error.message);
    if (value.action === "confirm" || value.action === "resume") after(() => continueCampaigns(value.businessId));
    return Response.json({ ok: true });
  } catch (e) { return fail(e); }
}
