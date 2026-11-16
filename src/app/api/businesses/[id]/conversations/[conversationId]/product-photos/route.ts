import { NextResponse } from "next/server";
import { isTransportId, transportAccess } from "@/lib/conversations/transport-access";

type Context = { params: Promise<{ id: string; conversationId: string }> };

/** Read-only: active products of this business that have a photo staff can send in the conversation.
 * Sending names only the product; the messages route reads its photo again. */
export async function GET(request: Request, context: Context) {
  const { id: businessId, conversationId } = await context.params;
  if (!isTransportId(conversationId)) return NextResponse.json({ error: "Biseda nuk u gjet." }, { status: 404 });
  const access = await transportAccess(businessId, request);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 80).replace(/[%_,()\\]/g, " ");
  let read = access.db.from("products").select("id,name,image_url").eq("business_id", businessId)
    .eq("is_active", true).is("archived_at", null).like("image_url", "https://%").order("name").limit(40);
  if (query) read = read.ilike("name", `%${query}%`);
  const { data, error } = await read;
  if (error) return NextResponse.json({ error: "Produktet nuk u ngarkuan." }, { status: 503 });
  const products = (data ?? []).map((p) => ({ id: p.id as string, name: p.name as string, imageUrl: p.image_url as string }));
  return NextResponse.json({ products }, { headers: { "Cache-Control": "private, no-store" } });
}
