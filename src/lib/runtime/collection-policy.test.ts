import { describe, expect, it, vi, afterEach } from "vitest";
import { collectionForNode, parseCollectionPolicy, type CollectionPin } from "./collection-policy";
import { assertBusinessEffectAllowed, CollectionEffectDenied, currentExecution, withCollectionPolicy, runWithExecution } from "./execution-context";
import { createServiceSupabase } from "@/lib/supabase/service";
import { submitConfirmedOrder } from "@/lib/orders/submission";
import { persistBooking } from "@/lib/calendar/service";
import { ensureCustomerForConversation } from "@/lib/conversations/ensure-customer";
import { executeWorkflowAction } from "@/lib/actions/workflow";
import { syncBooking, exchangeGoogleCode } from "@/lib/calendar/google";
import { provisionBusiness } from "@/lib/actions/provision";
import { submitExternalOrder } from "@/lib/integrations/zana";
import { sendInstagramText } from "@/lib/instagram/send";
import { sendWhatsAppText } from "@/lib/whatsapp/api";
import type { VisualVersion } from "@/lib/workflows/visual/types";

const pin: CollectionPin = { businessId: "tenant", revision: 1, versionId: "A", flowId: "retail", domain: "order", mode: "collection_only", profileFields: ["email"] };
const scope = { versionId: "A", flowId: "retail", domain: "order" as const, mode: "collection_only" as const, profileFields: ["email" as const] };
const version: VisualVersion = { id: "A", businessId: "tenant", createdAt: "", graph: { version: 2, name: "Test", nodes: [], edges: [], flows: [
  { id: "retail", label: "Retail", kind: "order", entryNodeId: "collect", nodeIds: ["collect"] },
  { id: "other", label: "Other", kind: "information", entryNodeId: "info", nodeIds: ["info"] },
] }, collectionPolicy: { version: 1, revision: 1, scopes: [scope] } };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("server-owned scoped collection policy", () => {
  it("preserves legacy absence and unrelated flows; no global opt-in", () => {
    expect(parseCollectionPolicy(null)).toBeNull();
    expect(collectionForNode({ ...version, collectionPolicy: null }, "collect")).toBeUndefined();
    expect(collectionForNode(version, "info")).toBeUndefined();
    expect(collectionForNode(version, "collect")).toEqual(pin);
  });
  it("rejects unknown modes, duplicate scopes and stale or foreign pins", () => {
    expect(() => parseCollectionPolicy({ ...version.collectionPolicy, scopes: [{ ...scope, mode: "execute" }] })).toThrow();
    expect(() => parseCollectionPolicy({ ...version.collectionPolicy, scopes: [scope, scope] })).toThrow();
    expect(() => collectionForNode(version, "collect", { ...pin, revision: 2 })).toThrow();
    expect(() => collectionForNode(version, "collect", { ...pin, businessId: "foreign" })).toThrow();
    expect(() => collectionForNode({ ...version, collectionPolicy: null }, "collect", pin)).toThrow();
  });
  it("does not silently apply A's policy to a newly published B", () => {
    expect(collectionForNode({ ...version, id: "B" }, "collect")).toBeUndefined();
    expect(collectionForNode(version, "collect", pin)?.versionId).toBe("A");
  });
  it("blocks effects, unknown RPCs and tables before IO, leaves manual execution unchanged", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-local-key");
    for (const key of ["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET", "GOOGLE_CALENDAR_REDIRECT_URI", "TOKEN_ENCRYPTION_KEY"])
      vi.stubEnv(key, "synthetic-only");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await withCollectionPolicy(pin, async () => {
      const db = createServiceSupabase();
      for (const table of ["orders", "bookings", "customers", "businesses", "unknown_future_table"])
        expect(() => db.from(table).insert({})).toThrow(CollectionEffectDenied);
      for (const rpc of ["submit_confirmed_order", "save_workflow_booking", "provision_business_invitation", "unknown_future_rpc"])
        expect(() => db.rpc(rpc)).toThrow(CollectionEffectDenied);
      for (const api of ["schema", "auth", "storage", "functions", "channel"])
        expect(() => Reflect.get(db, api)).toThrow(CollectionEffectDenied);
      await expect(submitConfirmedOrder({ businessId: "tenant", conversationId: "c", userId: "u" })).rejects.toThrow(CollectionEffectDenied);
      await expect(persistBooking("tenant", {} as never)).rejects.toThrow(CollectionEffectDenied);
      await expect(ensureCustomerForConversation({ businessId: "tenant", conversationId: "c" })).rejects.toThrow(CollectionEffectDenied);
      await expect(executeWorkflowAction({} as never)).rejects.toThrow(CollectionEffectDenied);
      await expect(syncBooking("tenant", {} as never)).rejects.toThrow(CollectionEffectDenied);
      await expect(exchangeGoogleCode("synthetic")).rejects.toThrow(CollectionEffectDenied);
      await expect(provisionBusiness({} as never)).rejects.toThrow(CollectionEffectDenied);
      await expect(submitExternalOrder({} as never)).rejects.toThrow(CollectionEffectDenied);
      const message = { accountId: "synthetic", token: "synthetic", to: "synthetic", body: "Synthetic" };
      await expect(sendInstagramText(message)).rejects.toThrow(CollectionEffectDenied);
      expect(await sendWhatsAppText(message)).toMatchObject({ ok: false });
      expect(() => withCollectionPolicy(undefined, () => {})).toThrow();
      expect(() => runWithExecution({ ...currentExecution(), collection: undefined }, () => {})).toThrow();
      expect(() => assertBusinessEffectAllowed("unclassified")).toThrow();
      // Construction of informational queries is allowed, no outbound request here.
      expect(() => db.from("products").select("id")).not.toThrow();
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(() => assertBusinessEffectAllowed("manual.order")).not.toThrow();
    expect(currentExecution().collection).toBeUndefined();
  });
  it("isolates concurrent turns rather than sharing an ambient global policy", async () => {
    await Promise.all([
      withCollectionPolicy(pin, async () => { await Promise.resolve(); expect(() => assertBusinessEffectAllowed("write")).toThrow(); }),
      Promise.resolve().then(() => expect(() => assertBusinessEffectAllowed("manual.write")).not.toThrow()),
    ]);
  });
});
