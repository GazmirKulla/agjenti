import { createServiceSupabase } from "@/lib/supabase/service";
import { migrateContext, profileKeys, setFact, type Fact } from "@/lib/workflows/context";
import type { ConversationStatePayload } from "@/lib/workflows/engine";
export async function hydrateProfile(businessId: string, participantId: string, input: ConversationStatePayload) {
    const state = migrateContext(input);
    if (input.schemaVersion === 2)
        return state;
    const { data, error } = await createServiceSupabase().from("conversation_profiles").select("profile").eq("business_id", businessId).eq("participant_id", participantId).maybeSingle();
    if (error)
        throw new Error("Nuk u lexua kujtesa e klientit.");
    let reused = false;
    for (const key of profileKeys) {
        const fact = data?.profile?.[key] as Fact | undefined;
        if (!state.context!.profile[key] && fact?.validated === true && typeof fact.value === "string")
            reused = setFact(state, `customer_${key}`, fact.value, key === "phone" ? "phone" : key === "email" ? "email" : "text", "profile_memory") || reused;
    }
    if (reused)
        state.context!.execution.profileConfirmation = "pending";
    return state;
}
