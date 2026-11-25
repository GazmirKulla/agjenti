"use server";
import { revalidatePath } from "next/cache";
import { manualCommandActor } from "@/lib/actions/command-actor";
import { saveBusinessService as saveService } from "./commands";
import { uuid } from "@/lib/calendar/model";
import { saveConfiguration } from "@/lib/agent-configuration/service";
export async function saveBusinessService(slug: string, form: FormData) {
  try {
    const actor = await manualCommandActor(slug);
    const result = await saveService(actor, form);
    if (!("error" in result)) revalidatePath(`/b/${actor.business.slug}`, "layout");
    return result;
  }
  catch (error) { return { error: (error as Error).message }; }
}

/** Rezervimet: whether the agent books one service itself; false means it gives information and staff take the booking. */
export async function saveServiceBooking(slug: string, serviceId: string, enabled: boolean, updatedAt: string) {
  try {
    if (!uuid(serviceId) || typeof enabled !== "boolean" || typeof updatedAt !== "string" || !updatedAt) throw new Error("Zgjedhja nuk është e vlefshme.");
    const actor = await manualCommandActor(slug);
    // Whether the agent books this service is an agent permission: through the shared configuration change,
    // against the service as the owner saw it.
    await saveConfiguration(actor.business.id, actor.userId, [{ type: "service.booking", id: serviceId, booking_enabled: enabled, expected: updatedAt }], "owner");
    revalidatePath(`/b/${actor.business.slug}`, "layout");
    return { success: enabled ? "U zbatua: Agjenti rezervon këtë shërbim." : "U zbatua: Agjenti jep vetëm informacion për këtë shërbim; rezervimin e merr stafi." };
  }
  catch (error) { return { error: (error as Error).message }; }
}
