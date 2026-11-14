"use server";
import { revalidatePath } from "next/cache";
import { manualCommandActor } from "@/lib/actions/command-actor";
import { requireActionAccess } from "@/lib/actions/access";
import { describeSync, syncLinkedProducts } from "./linked-sync";

/** "Rifresko nga webi": every linked product takes the website's current prices, variants and declared fields. */
export async function refreshLinkedProducts(slug: string) {
  try {
    const actor = await manualCommandActor(slug);
    // Same permission as linking a product from the website catalog.
    await requireActionAccess(actor.business.id, actor.userId, "product.create");
    const result = await syncLinkedProducts({ businessId: actor.business.id, userId: actor.userId });
    revalidatePath(`/b/${actor.business.slug}`, "layout");
    return describeSync(result);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Produktet nuk u rifreskuan." };
  }
}
