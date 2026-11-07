import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ from: vi.fn(), eq: vi.fn(), row: {} as Record<string, unknown> | null }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from }) }));
import { readProcessProfile } from "./profile";
beforeEach(() => { vi.clearAllMocks(); const chain = { select: () => chain, eq: (...a: unknown[]) => { m.eq(...a); return chain; }, maybeSingle: async () => ({ data: m.row, error: null }) }; m.from.mockReturnValue(chain); });
it("reads validated participant memory without copying it into conversation fields", async () => {
    m.row = { profile: { phone: { value: "+355691234567", validated: true }, name: { value: "Ana", validated: true }, address: { value: "Invented", validated: false } } };
    expect(await readProcessProfile("business-a", "participant-a")).toEqual({
      phone: { value: "+355691234567", type: "phone" },
      name: { value: "Ana", type: "text" },
    });
    expect(m.from).toHaveBeenCalledExactlyOnceWith("conversation_profiles");
});
it("uses participant identity inside the business and never promotes a CRM customer", async () => {
    m.row = { profile: { phone: { value: "+355691234567", validated: true }, name: { value: "Ana", validated: true }, address: { value: "Invented", validated: false } } };
    expect(await readProcessProfile("business-a", "participant-a")).toEqual({
      phone: { value: "+355691234567", type: "phone" },
      name: { value: "Ana", type: "text" },
    });
    expect(m.eq).toHaveBeenCalledWith("business_id", "business-a");
    expect(m.eq).toHaveBeenCalledWith("participant_id", "participant-a");
    expect(m.from).toHaveBeenCalledExactlyOnceWith("conversation_profiles");
});
it.each(["instagram", "whatsapp"] as const)("isolates %s profile memory and drops invalid values", async channel => {
    m.row = { profile: { name: { value: "Ana", validated: true }, phone: { value: "not-a-phone", validated: true } } };
    expect(await readProcessProfile("business-a", "participant-a", channel)).toEqual({ name: { value: "Ana", type: "text" } });
    expect(m.eq).toHaveBeenCalledWith("channel", channel);
    expect(m.eq).toHaveBeenCalledWith("business_id", "business-a");
    expect(m.eq).toHaveBeenCalledWith("participant_id", "participant-a");
});
it("returns nothing when the participant has no validated memory", async () => {
    m.row = null;
    expect(await readProcessProfile("business-a", "participant-a")).toBeUndefined();
});
