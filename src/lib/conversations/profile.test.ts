import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ from: vi.fn(), eq: vi.fn(), row: {} as Record<string, unknown> }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: m.from }) }));
import { hydrateProfile } from "./profile";
import { emptyState } from "@/lib/workflows/engine";
beforeEach(() => { vi.clearAllMocks(); const chain = { select: () => chain, eq: (...a: unknown[]) => { m.eq(...a); return chain; }, maybeSingle: async () => ({ data: m.row, error: null }) }; m.from.mockReturnValue(chain); });
it("uses participant identity inside the business and never promotes a CRM customer", async () => {
    m.row = { profile: { phone: { value: "+355691234567", validated: true }, name: { value: "Ana", validated: true }, address: { value: "Invented", validated: false } } };
    const s = await hydrateProfile("business-a", "participant-a", emptyState());
    expect(m.eq).toHaveBeenCalledWith("business_id", "business-a");
    expect(m.eq).toHaveBeenCalledWith("participant_id", "participant-a");
    expect(m.from).toHaveBeenCalledExactlyOnceWith("conversation_profiles");
    expect(s.customer.phone).toBe("+355691234567");
    expect(s.customer.address).toBeNull();
    expect(s.context?.execution.profileConfirmation).toBe("pending");
    await hydrateProfile("business-a", "participant-a", s);
    expect(m.from).toHaveBeenCalledTimes(1);
});

it.each(["instagram", "whatsapp"] as const)("isolates %s profile memory and preserves facts already collected in the active conversation", async channel => {
    m.row = { profile: { name: { value: "Old name", validated: true }, phone: { value: "+355691234567", validated: true } } };
    const state = emptyState(); state.customer.name = "Current name";
    const next = await hydrateProfile("business-a", "participant-a", state, channel);
    expect(m.eq).toHaveBeenCalledWith("channel", channel);
    expect(m.eq).toHaveBeenCalledWith("business_id", "business-a");
    expect(m.eq).toHaveBeenCalledWith("participant_id", "participant-a");
    expect(next.customer.name).toBe("Current name");
    expect(next.customer.phone).toBe("+355691234567");
    expect(next.context?.execution.profileConfirmation).toBe("pending");
    expect(state.customer.phone).toBeNull();
});
