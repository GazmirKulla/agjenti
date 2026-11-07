import { createServiceSupabase } from "@/lib/supabase/service";
import { profileKeys, validValue, type Fact } from "@/lib/workflows/context";
import type { ProfileMemory } from "@/lib/orchestration/contracts";

/** Native runtime read. Never copies CRM values into instance facts or legacy fields. */
export async function readProcessProfile(businessId: string, participantId: string, channel: "instagram" | "whatsapp" = "instagram"): Promise<ProfileMemory | undefined> {
    const { data, error } = await createServiceSupabase().from("conversation_profiles").select("profile").eq("business_id", businessId).eq("participant_id", participantId).eq("channel", channel).maybeSingle();
    if (error) throw new Error("Nuk u lexua kujtesa e klientit.");
    const memory: ProfileMemory = {};
    for (const key of profileKeys) {
        const fact = data?.profile?.[key] as Fact | undefined;
        const type = key === "phone" ? "phone" as const : key === "email" ? "email" as const : "text" as const;
        if (fact?.validated === true && typeof fact.value === "string" && validValue(fact.value, type)) memory[key] = { value: fact.value, type };
    }
    return Object.keys(memory).length ? memory : undefined;
}
