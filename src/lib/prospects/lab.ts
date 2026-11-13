import { connectedToAnotherBusiness, emptyPublicProfile } from "@/lib/instagram/account-rules";
import { ownUsername } from "./turn-context";
import { prospectReplyContext, prospectScanPolicy, prospectUsernameFromMessage, readPublicAccount, type ProspectScan } from "./instagram-scan";

type Deps = {
  policy?: typeof prospectScanPolicy; connected?: typeof connectedToAnotherBusiness;
  read?: typeof readPublicAccount; ownUsername?: (businessId: string) => Promise<string | null>; timeoutMs?: number;
};

/** Longest wait for a test read, leaving the reply time within the 180s test turn. */
export const LAB_READ_MS = 110_000;

export type LabProspect = {
  /** Kept in the sealed test session so later test messages still know the account. */
  scan: ProspectScan | null;
  /** What the agent receives, exactly as on a live chat. */
  context: unknown;
  /** What Chat Lab shows the admin. */
  trace: Record<string, unknown> | null;
};

/** Chat Lab version of the prospect read: the same rules and the same real public
 * read, but nothing is stored, no invitation can follow and the business's
 * monthly allowance is not used. Waits for the read, however slow. */
export async function labProspectRead(p: { businessId: string; message: string; previous: ProspectScan | null }, deps: Deps = {}): Promise<LabProspect> {
  const none = { scan: p.previous, context: undefined, trace: null };
  try {
    const policy = await (deps.policy ?? prospectScanPolicy)(p.businessId);
    if (!policy.allowed) return none;
    const own = await (deps.ownUsername ?? ownUsername)(p.businessId);
    const username = prospectUsernameFromMessage(p.message, own);
    if (!username || username === p.previous?.username) {
      if (!p.previous) return none;
      return { scan: p.previous, context: prospectReplyContext({ kind: "existing", scan: p.previous }, p.previous), trace: labTrace(p.previous, "reused") };
    }
    if (await (deps.connected ?? connectedToAnotherBusiness)(username, p.businessId)) {
      const context = prospectReplyContext({ kind: "refused", reason: "already_registered", username }, null);
      return { scan: p.previous, context, trace: { username, result: "already_registered", note: "E lidhur me Instagram login te një biznes tjetër: nuk lexohet dhe nuk ftohet." } };
    }
    const started = Date.now();
    // The test turn has 180s in all; a slower read is reported, not waited for.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const slow = new Promise<Awaited<ReturnType<typeof readPublicAccount>>>(resolve => { timer = setTimeout(() => resolve({ status: "failed", profile: null, posts: null, stats: null,
      fetched_at: null, error: "Leximi zgjati shumë. Provo përsëri pas pak." }), deps.timeoutMs ?? LAB_READ_MS); });
    const read = await Promise.race([(deps.read ?? readPublicAccount)(username), slow]).finally(() => clearTimeout(timer));
    const scan: ProspectScan = { id: "lab", business_id: p.businessId, conversation_id: "lab", username, ...read, updated_at: new Date().toISOString(), target_business_id: null };
    return { scan, context: prospectReplyContext({ kind: "existing", scan }, scan), trace: labTrace(scan, "read", Date.now() - started) };
  } catch {
    return none;
  }
}

function labTrace(scan: ProspectScan, source: "read" | "reused", elapsedMs?: number) {
  const result = scan.status === "ready" && emptyPublicProfile(scan) ? "empty" : scan.status;
  return {
    username: scan.username, result, source, ...(elapsedMs !== undefined ? { readSeconds: Math.round(elapsedMs / 100) / 10 } : {}),
    ...(scan.error ? { error: scan.error } : {}),
    ...(scan.status === "ready" ? { profile: scan.profile, stats: scan.stats, posts: (scan.posts ?? []).map(post => ({ type: post.mediaType, caption: post.caption?.slice(0, 300) ?? "" })) } : {}),
    note: "Provë: asgjë nuk ruhet, nuk krijohet ftesë dhe nuk llogaritet te kufiri mujor.",
  };
}
