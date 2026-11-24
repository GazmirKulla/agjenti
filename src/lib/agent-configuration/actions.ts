"use server";
import { revalidatePath } from "next/cache";
import { manualCommandActor } from "@/lib/actions/command-actor";
import { ConfigurationError, revertConfiguration } from "./service";

/** Historiku → Rikthe: a kept version becomes the configuration again, as a new version, or nothing changes. */
export async function restoreConfiguration(slug: string, formData: FormData) {
  let actor;
  try { actor = await manualCommandActor(slug); } catch (error) { return { error: (error as Error).message }; }
  const requestId = String(formData.get("request_id") ?? "");
  try {
    const result = await revertConfiguration(actor.business.id, actor.userId, Number(formData.get("revision")), Number(formData.get("base")),
      /^[0-9a-f-]{36}$/i.test(requestId) ? requestId : undefined);
    revalidatePath(`/b/${actor.business.slug}`, "layout");
    return { success: result.message, next: { href: `/b/${actor.business.slug}/agents/test`, label: "Provo Agjentin" } };
  } catch (error) { return { error: error instanceof ConfigurationError ? error.message : "Rikthimi nuk u krye. Asgjë nuk u ndryshua." }; }
}
