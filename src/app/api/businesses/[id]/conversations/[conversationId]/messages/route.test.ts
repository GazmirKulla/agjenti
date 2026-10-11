import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ from: vi.fn(), send: vi.fn(), getUser: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ({ auth: { getUser: m.getUser } }) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from }) }));
vi.mock("@/lib/tenant/access", () => ({ isPlatformAdmin: m.admin }));
vi.mock("@/lib/crypto/tokens", () => ({ decryptSecret: () => "test" }));
vi.mock("@/lib/conversations/channel", () => ({ channelAdapter: () => ({ table: "instagram_connections", connection: "instagram_connection_id", participant: "instagram_participant_id", send: m.send }) }));
import { POST } from "./route";
const call = () => POST(new Request("https://example.test/messages", { method: "POST", body: JSON.stringify({ body: "Përshëndetje nga stafi" }) }), { params: Promise.resolve({ id: "business", conversationId: "conversation" }) });
let events: string[];
let writes: {table:string; data:Record<string,unknown>; filters:Record<string,unknown>}[];
let ownershipError: boolean;
let historyError: boolean;
let conversationStatus: string;
beforeEach(() => {
  vi.clearAllMocks(); events = []; writes = []; ownershipError = false; historyError = false; conversationStatus = "active";
  m.getUser.mockResolvedValue({ data: { user: { id: "user" } } }); m.admin.mockResolvedValue(true);
  m.send.mockImplementation(async () => { events.push("send"); return { ok: true, messageId: "sent-id" }; });
  m.from.mockImplementation((table: string) => {
    let patch: Record<string,unknown> | undefined;
    const filters: Record<string,unknown> = {};
    const result = () => {
      if (patch) {
        if (patch.status === "paused") events.push("pause");
        return { data: ownershipError ? null : { id: "conversation" }, error: (ownershipError && patch.status === "paused" || historyError && table === "messages") ? {message:"DB error"} : null };
      }
      return { data: table === "conversations" ? { id:"conversation", business_id:"business", channel:"instagram", instagram_participant_id:"person", instagram_connection_id:"connection", last_inbound_at:new Date().toISOString(), status:conversationStatus } : { ig_user_id:"account", status:"connected", access_token_ciphertext:"sealed" }, error:null };
    };
    const chain = { select: () => chain, eq: (key:string, value:unknown) => { filters[key]=value; return chain; }, maybeSingle: async () => result(),
      update: (data:Record<string,unknown>) => {patch=data; writes.push({table,data,filters}); return chain;},
      insert: (data:Record<string,unknown>) => {patch=data; writes.push({table,data,filters}); return chain;},
      then: (resolve:(value:unknown)=>unknown) => Promise.resolve(result()).then(resolve),
    }; return chain;
  });
});
it.each(["active", "paused", "completed"])("claims staff ownership before sending from %s and never restores stale status", async status => {
  conversationStatus = status;
  expect((await call()).status).toBe(200);
  expect(events).toEqual(["pause","send"]);
  expect(writes[0]).toMatchObject({ table:"conversations", data:{status:"paused",auto_reply:false,openai_previous_response_id:null}, filters:{id:"conversation",business_id:"business"} });
  expect(writes.at(-1)?.data).not.toHaveProperty("status");
});
it("does not send if staff ownership cannot be confirmed", async () => {
  ownershipError = true;
  expect((await call()).status).toBe(409);
  expect(m.send).not.toHaveBeenCalled();
});
it("leaves AI paused when the provider rejects the staff reply", async () => {
  m.send.mockResolvedValue({ ok:false, error:"Unavailable" });
  expect((await call()).status).toBe(400);
  expect(writes).toHaveLength(1);
  expect(writes[0].data).toMatchObject({status:"paused",auto_reply:false});
});
it("does not claim success when a delivered staff message cannot be persisted", async () => {
  historyError = true;
  const response = await call();
  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({delivered:true,messageId:"sent-id"});
  expect(m.send).toHaveBeenCalledOnce();
});
it("rejects unauthenticated takeover", async () => {
  m.getUser.mockResolvedValue({data:{user:null}});
  expect((await call()).status).toBe(403);
  expect(m.from).not.toHaveBeenCalled();
  expect(m.send).not.toHaveBeenCalled();
});
