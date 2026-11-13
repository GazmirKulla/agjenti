import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => { throw new Error("no live database in tests"); } }));
import {
  attachProspectScanToInvitation, prefillAcceptedBusiness, prospectReplyContext, prospectUsernameFromMessage,
  requestProspectScan, runProspectScan, MAX_SCANS_PER_CONVERSATION, type ProspectScan,
} from "./instagram-scan";
import { PublicInstagramError } from "@/lib/instagram/public-profile";

type Call = { table: string; op: string; filters: [string, string, unknown][]; payload?: unknown };
type Result = { data?: unknown; error?: { code?: string; message?: string } | null; count?: number };
/** A chainable Supabase stand-in: every finished query asks `answer`. */
function fakeDb(answer: (call: Call) => Result, rpc: (name: string, args: unknown) => Result = () => ({ data: null })) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    const builder: Record<string, unknown> = {};
    const chain = (name: string) => (...args: unknown[]) => {
      if (["insert", "update", "upsert", "delete"].includes(name)) { call.op = name; call.payload = args[0]; }
      else if (["eq", "neq", "gte", "lt", "in"].includes(name)) call.filters.push([name, String(args[0]), args[1]]);
      return builder;
    };
    for (const name of ["select", "insert", "update", "upsert", "delete", "eq", "neq", "gte", "lt", "in", "order", "limit", "not"]) builder[name] = chain(name);
    const finish = () => { calls.push(call); return Promise.resolve({ error: null, ...answer(call) }); };
    builder.maybeSingle = finish;
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => finish().then(resolve, reject);
    return builder;
  };
  return { db: { from, rpc: (name: string, args: unknown) => Promise.resolve({ error: null, ...rpc(name, args) }) } as never, calls };
}
const scan = (fields: Partial<ProspectScan> = {}): ProspectScan => ({ id: "scan-1", business_id: "agjenti", conversation_id: "chat", username: "dyqani.al",
  status: "ready", profile: { name: "Dyqani", biography: "Rroba për fëmijë · porosi në DM" }, posts: [{ id: "1", caption: "Koleksioni i ri", imageUrl: null, permalink: null, mediaType: "IMAGE" }],
  stats: { followers: 1200, posts: 80 }, error: null, fetched_at: "2026-11-13T10:00:00Z", updated_at: "2026-11-13T10:00:00Z", ...fields });

describe("prospectUsernameFromMessage", () => {
  it("reads a profile link or an @username the prospect wrote", () => {
    expect(prospectUsernameFromMessage("Ky është faqja jonë https://www.instagram.com/Dyqani.AL/?igsh=abc")).toBe("dyqani.al");
    expect(prospectUsernameFromMessage("Na gjeni te @dyqani.al.")).toBe("dyqani.al");
    expect(prospectUsernameFromMessage("(@salloni_ana) a mund të na ndihmoni?")).toBe("salloni_ana");
  });
  it("ignores emails, post links, plain text and the business's own account", () => {
    expect(prospectUsernameFromMessage("shkruani te info@dyqani.al")).toBeNull();
    expect(prospectUsernameFromMessage("shiko https://instagram.com/p/Cx12ab/")).toBeNull();
    expect(prospectUsernameFromMessage("kam një dyqan me rroba")).toBeNull();
    expect(prospectUsernameFromMessage("ju gjeta te @agjenti.app", "@Agjenti.app")).toBeNull();
    expect(prospectUsernameFromMessage("@agjenti.app më dërgoi te @dyqani.al", "agjenti.app")).toBe("dyqani.al");
  });
});

describe("prospectReplyContext", () => {
  it("gives the agent the public profile and the modules it may offer", () => {
    const context = prospectReplyContext({ kind: "existing", scan: scan() }, scan()) as Record<string, unknown>;
    expect(context.status).toBe("ready");
    expect(context.profile).toMatchObject({ name: "Dyqani", username: "dyqani.al" });
    expect(context.recentPosts).toEqual([{ type: "IMAGE", caption: "Koleksioni i ri" }]);
    expect((context.modules as { id: string }[]).map(m => m.id)).toEqual(expect.arrayContaining(["products", "orders", "bookings"]));
  });
  it("never hands over profile data that was not read", () => {
    for (const status of ["queued", "running", "not_found", "failed"] as const) {
      const context = prospectReplyContext({ kind: "queued", scan: scan({ status, profile: null, posts: null }) }, null) as Record<string, unknown>;
      expect(context.profile).toBeUndefined();
      expect(context.status).toBe(status === "running" ? "queued" : status);
    }
    expect(prospectReplyContext({ kind: "refused", reason: "monthly_limit", username: "x" }, null)).toMatchObject({ status: "limit_reached" });
    expect(prospectReplyContext(null, null)).toBeUndefined();
  });
});

describe("requestProspectScan", () => {
  const params = { businessId: "agjenti", conversationId: "chat", username: "dyqani.al", monthlyLimit: 50 };
  it("reuses the chat's read of the same account", async () => {
    const { db, calls } = fakeDb(() => ({ data: [scan({ status: "queued" })] }));
    await expect(requestProspectScan(params, db)).resolves.toMatchObject({ kind: "existing" });
    expect(calls.some(c => c.op === "insert")).toBe(false);
  });
  it("refuses a third account in the same chat and a spent monthly allowance", async () => {
    const many = Array.from({ length: MAX_SCANS_PER_CONVERSATION }, (_, i) => scan({ id: `s${i}`, username: `other${i}` }));
    await expect(requestProspectScan(params, fakeDb(() => ({ data: many })).db)).resolves.toMatchObject({ kind: "refused", reason: "conversation_limit" });
    const spent = fakeDb(call => call.filters.some(([, column]) => column === "created_at") ? { count: 50 } : { data: [] });
    await expect(requestProspectScan(params, spent.db)).resolves.toMatchObject({ kind: "refused", reason: "monthly_limit" });
    expect(spent.calls.some(c => c.op === "insert")).toBe(false);
  });
  it("queues a new read within the limits", async () => {
    const { db, calls } = fakeDb(call => call.op === "insert" ? { data: scan({ status: "queued" }) } : call.filters.some(([, c]) => c === "created_at") ? { count: 3 } : { data: [] });
    await expect(requestProspectScan(params, db)).resolves.toMatchObject({ kind: "queued", scan: { status: "queued" } });
    expect(calls.find(c => c.op === "insert")?.payload).toEqual({ business_id: "agjenti", conversation_id: "chat", username: "dyqani.al" });
  });
});

describe("runProspectScan", () => {
  it("stores the public read of a claimed scan", async () => {
    const { db, calls } = fakeDb(() => ({}), () => ({ data: scan({ status: "running" }) }));
    const fetcher = vi.fn().mockResolvedValue({ profile: { name: "Dyqani" }, posts: [{ id: "1", caption: "x".repeat(3000), imageUrl: null, permalink: null, mediaType: "IMAGE" }], stats: { followers: 5 } });
    await expect(runProspectScan("scan-1", { db, fetcher })).resolves.toBe("ready");
    expect(fetcher).toHaveBeenCalledWith("dyqani.al");
    const saved = calls.find(c => c.op === "update")!.payload as { status: string; posts: { caption: string }[] };
    expect(saved.status).toBe("ready");
    expect(saved.posts[0].caption).toHaveLength(1500);
  });
  it("marks a private or unknown account and skips a scan it could not claim", async () => {
    const { db, calls } = fakeDb(() => ({}), () => ({ data: scan({ status: "running" }) }));
    const missing = vi.fn().mockRejectedValue(new PublicInstagramError("nuk u gjet", "not_found"));
    await expect(runProspectScan("scan-1", { db, fetcher: missing })).resolves.toBe("not_found");
    expect(calls.find(c => c.op === "update")!.payload).toMatchObject({ status: "not_found" });
    const unclaimed = fakeDb(() => ({}), () => ({ data: { id: null } }));
    const fetcher = vi.fn();
    await expect(runProspectScan("scan-1", { db: unclaimed.db, fetcher })).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("invitation", () => {
  it("adds the read username to a pending invitation of this chat", async () => {
    const { db, calls } = fakeDb(call => call.table === "prospect_scans" && call.op === "select" ? { data: scan() }
      : call.table === "business_invitations" && call.op === "select" ? { data: { id: "inv", status: "pending", details: { name: "Dyqani", email: "a@b.al" } } } : {});
    await expect(attachProspectScanToInvitation({ businessId: "agjenti", conversationId: "chat", targetBusinessId: "new" }, db)).resolves.toBe(true);
    expect(calls.find(c => c.table === "business_invitations" && c.op === "update")?.payload).toEqual({ details: { name: "Dyqani", email: "a@b.al", instagramUsername: "dyqani.al" } });
    expect(calls.find(c => c.table === "prospect_scans" && c.op === "update")?.payload).toMatchObject({ target_business_id: "new" });
  });
  it("does nothing without a read account or after the invitation was used", async () => {
    const none = fakeDb(() => ({ data: null }));
    await expect(attachProspectScanToInvitation({ businessId: "agjenti", conversationId: "chat", targetBusinessId: "new" }, none.db)).resolves.toBe(false);
    const used = fakeDb(call => call.table === "prospect_scans" ? { data: scan() } : { data: { id: "inv", status: "accepted", details: {} } });
    await expect(attachProspectScanToInvitation({ businessId: "agjenti", conversationId: "chat", targetBusinessId: "new" }, used.db)).resolves.toBe(false);
    expect(used.calls.some(c => c.op === "update")).toBe(false);
  });
  it("starts the owner's review scan only for the person who accepted", async () => {
    const accepted = { source_business_id: "agjenti", status: "accepted", accepted_by: "owner", details: { instagramUsername: "dyqani.al" } };
    const { db, calls } = fakeDb(call => call.table === "business_invitations" ? { data: accepted } : call.table === "prospect_scans" ? { data: scan({ target_business_id: "new" }) } : {});
    const saveUsername = vi.fn().mockResolvedValue({});
    await expect(prefillAcceptedBusiness("new", "owner", { db, saveUsername })).resolves.toBe(true);
    expect(saveUsername).toHaveBeenCalledWith("new", "owner", "dyqani.al");
    expect(calls.find(c => c.table === "business_source_previews")?.payload).toMatchObject({ business_id: "new", instagram: { username: "dyqani.al", fetchedAt: "2026-11-13T10:00:00Z" } });
    const other = fakeDb(() => ({ data: accepted }));
    await expect(prefillAcceptedBusiness("new", "someone-else", { db: other.db, saveUsername })).resolves.toBe(false);
    expect(saveUsername).toHaveBeenCalledTimes(1);
  });
});
