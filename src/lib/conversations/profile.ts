import { createServiceSupabase } from "@/lib/supabase/service";
import { profileKeys, validValue, type Fact } from "@/lib/workflows/context";
import type { ProfileMemory } from "@/lib/orchestration/contracts";
import { CONTACT_KEYS, orderDelivery, resolveContact } from "@/lib/customers/contact";

/** Native runtime read. Never copies CRM values into instance facts or legacy fields. */
export async function readProcessProfile(businessId: string, participantId: string, channel: "instagram" | "whatsapp" = "instagram"): Promise<ProfileMemory | undefined> {
    return (await readProcessProfileEntry(businessId, participantId, channel)).memory;
}

/** The same memory with the time it was last written, for display next to other sources. */
export async function readProcessProfileEntry(businessId: string, participantId: string, channel: "instagram" | "whatsapp" = "instagram"): Promise<{ memory: ProfileMemory | undefined; updatedAt: string | null }> {
    const { data, error } = await createServiceSupabase().from("conversation_profiles").select("profile,updated_at").eq("business_id", businessId).eq("participant_id", participantId).eq("channel", channel).maybeSingle();
    if (error) throw new Error("Nuk u lexua kujtesa e klientit.");
    const memory: ProfileMemory = {};
    for (const key of profileKeys) {
        const fact = data?.profile?.[key] as Fact | undefined;
        const type = key === "phone" ? "phone" as const : key === "email" ? "email" as const : "text" as const;
        if (fact?.validated === true && typeof fact.value === "string" && validValue(fact.value, type)) memory[key] = { value: fact.value, type };
    }
    const updatedAt = typeof data?.updated_at === "string" ? data.updated_at : null;
    return { memory: Object.keys(memory).length ? memory : undefined, updatedAt };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * What the customer agent knows of this person's contact: the same answer the Inbox shows (resolveContact over
 * the saved customer, the delivery of their latest order and the agent's own memory), for this business and
 * this verified conversation only. Every value passes its format check; none is treated as authorization.
 */
export async function readAgentContact(businessId: string, identity: { conversationId: string; instagramParticipantId: string; channel?: "instagram" | "whatsapp" }): Promise<ProfileMemory | undefined> {
    if (!UUID.test(businessId) || !UUID.test(identity.conversationId)) return undefined;
    const db = createServiceSupabase();
    const [conversation, saved] = await Promise.all([
        db.from("conversations").select("customer_id,customers(business_id,display_name,phone,created_at,updated_at)")
            .eq("business_id", businessId).eq("id", identity.conversationId).maybeSingle(),
        readProcessProfileEntry(businessId, identity.instagramParticipantId, identity.channel ?? "instagram").catch(() => ({ memory: undefined, updatedAt: null })),
    ]);
    if (conversation.error || !conversation.data) return saved.memory;
    const customerId = typeof conversation.data.customer_id === "string" && UUID.test(conversation.data.customer_id) ? conversation.data.customer_id : null;
    const joined = (Array.isArray(conversation.data.customers) ? conversation.data.customers[0] : conversation.data.customers) as
        { business_id: string; display_name: string | null; phone: string | null; created_at: string | null; updated_at: string | null } | null;
    const customer = joined?.business_id === businessId ? joined : null;
    // The latest order of this conversation, or of the same saved customer in this business.
    const orders = await db.from("orders").select("created_at,delivery:payload->customer").eq("business_id", businessId)
        .or(customerId ? `conversation_id.eq.${identity.conversationId},customer_id.eq.${customerId}` : `conversation_id.eq.${identity.conversationId}`)
        .order("created_at", { ascending: false }).limit(5);
    const latest = (orders.error ? [] : orders.data ?? []).map(order => ({ values: orderDelivery({ customer: order.delivery }), at: order.created_at as string }))
        .find(entry => entry.values);
    const contact = resolveContact({
        crm: customer ? { values: { name: customer.display_name, phone: customer.phone }, at: customer.updated_at ?? customer.created_at } : null,
        order: latest?.values ? { values: latest.values, at: latest.at } : null,
        agent: saved.memory ? { values: Object.fromEntries(Object.entries(saved.memory).map(([key, item]) => [key, item?.value])), at: saved.updatedAt } : null,
    });
    const memory: ProfileMemory = {};
    for (const key of CONTACT_KEYS) {
        const value = contact[key]?.value;
        const type = key === "phone" ? "phone" as const : key === "email" ? "email" as const : "text" as const;
        if (value && validValue(value, type)) memory[key] = { value, type };
    }
    return Object.keys(memory).length ? memory : undefined;
}
