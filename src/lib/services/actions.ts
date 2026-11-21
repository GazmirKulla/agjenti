"use server";
import { revalidatePath } from "next/cache";
import { manualCommandActor } from "@/lib/actions/command-actor";
import { saveBusinessService as saveService } from "./commands";
import { createServiceSupabase } from "@/lib/supabase/service";
import { uuid } from "@/lib/calendar/model";
import { serviceColumns } from "./model";
export async function saveBusinessService(slug: string, form: FormData) {
  try {
    const actor = await manualCommandActor(slug);
    const result = await saveService(actor, form);
    if (!("error" in result)) revalidatePath(`/b/${actor.business.slug}`, "layout");
    return result;
  }
  catch (error) { return { error: (error as Error).message }; }
}

/** Çfarë bën Agjenti: whether one service accepts bookings. The same writer as the service form; the rest stays as stored. */
export async function saveServiceBooking(slug: string, serviceId: string, enabled: boolean, updatedAt: string) {
  try {
    if (!uuid(serviceId) || typeof enabled !== "boolean" || typeof updatedAt !== "string" || !updatedAt) throw new Error("Zgjedhja nuk është e vlefshme.");
    const actor = await manualCommandActor(slug);
    const { data, error } = await createServiceSupabase().from("booking_services").select(serviceColumns).eq("business_id", actor.business.id).eq("id", serviceId).maybeSingle();
    if (error || !data) throw new Error("Shërbimi nuk u gjet.");
    const before = data as unknown as Record<string, unknown>;
    if (before.updated_at !== updatedAt) throw new Error("Shërbimi ndryshoi. Rifresko faqen.");
    const { serviceForm } = await import("@/lib/actions/operations/service");
    const form = serviceForm({ ...before, booking_enabled: enabled });
    form.set("id", serviceId); form.set("updatedAt", updatedAt);
    const result = await saveService(actor, form);
    if (!("error" in result)) { revalidatePath(`/b/${actor.business.slug}`, "layout"); return { success: enabled ? "Shërbimi pranon rezervime." : "Shërbimi nuk pranon më rezervime." }; }
    return result;
  }
  catch (error) { return { error: (error as Error).message }; }
}
