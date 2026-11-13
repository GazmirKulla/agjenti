import { createServiceSupabase } from "@/lib/supabase/service";
import { workerOrigin } from "@/lib/discovery/continue";
import { normalizeInstagramUsername } from "@/lib/instagram/public-profile";
import {
  prospectReplyContext, prospectScanPolicy, prospectUsernameFromMessage, requestProspectScan,
  REPLY_WAIT_MS, waitForProspectScan, wakeProspectScan, type ProspectScan, type ScanRequest,
} from "./instagram-scan";

type Deps = {
  policy?: typeof prospectScanPolicy; request?: typeof requestProspectScan; wake?: typeof wakeProspectScan;
  wait?: typeof waitForProspectScan; ownUsername?: (businessId: string) => Promise<string | null>;
  latest?: (businessId: string, conversationId: string) => Promise<ProspectScan | null>;
};

/** The business's own Instagram username, never read as a prospect. */
export async function ownUsername(businessId: string) {
  const { data } = await createServiceSupabase().from("businesses").select("instagram_username").eq("id", businessId).maybeSingle();
  return typeof data?.instagram_username === "string" ? data.instagram_username : null;
}
async function latestScan(businessId: string, conversationId: string) {
  const { data } = await createServiceSupabase().from("prospect_scans")
    .select("id,business_id,conversation_id,username,status,profile,posts,stats,error,fetched_at,updated_at,target_business_id")
    .eq("business_id", businessId).eq("conversation_id", conversationId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  return (data as ProspectScan | null) ?? null;
}

/** For a business allowed to scan prospects (Agjenti.app), on a live chat: the
 * account the prospect named in this message is read (public data only), or
 * the chat's earlier read is reused. Any failure leaves the reply unchanged. */
export async function prospectTurnContext(p: { businessId: string; conversationId: string; message: string; deadline: number; sender?: string | null }, deps: Deps = {}) {
  try {
    const policy = await (deps.policy ?? prospectScanPolicy)(p.businessId);
    if (!policy.allowed) return undefined;
    const own = await (deps.ownUsername ?? ownUsername)(p.businessId);
    let username = prospectUsernameFromMessage(p.message, own);
    if (!username) {
      // The account the chat last talked about; else the customer's own account from Real chat Inputs.
      const previous = await (deps.latest ?? latestScan)(p.businessId, p.conversationId);
      if (previous) return prospectReplyContext({ kind: "existing", scan: previous }, previous);
      const sender = p.sender ? normalizeInstagramUsername(p.sender) : null;
      if (!sender || sender === (own ? normalizeInstagramUsername(own) : null)) return undefined;
      username = sender;
    }
    const request: ScanRequest = await (deps.request ?? requestProspectScan)({ businessId: p.businessId, conversationId: p.conversationId, username, monthlyLimit: policy.monthlyLimit });
    if (request.kind === "refused") return prospectReplyContext(request, null);
    let scan = request.scan;
    if (["queued", "running"].includes(scan.status)) {
      if (request.kind === "queued") await (deps.wake ?? wakeProspectScan)(scan.id, workerOrigin());
      // The reply still needs time after this; a slow read answers on a later message.
      const until = Math.min(Date.now() + REPLY_WAIT_MS, p.deadline - 24_000);
      if (until > Date.now()) scan = await (deps.wait ?? waitForProspectScan)(scan.id, until) ?? scan;
    }
    return prospectReplyContext(request, scan);
  } catch {
    return undefined;
  }
}
