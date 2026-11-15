import { NextResponse } from "next/server";
import { isTransportId, transportAccess } from "@/lib/conversations/transport-access";
import { fetchExternalOrder, sendExternalOrderFiles } from "@/lib/integrations/zana";
import { ORDER_FILES_BUCKET } from "@/lib/orders/dispatch";
import { orderOutputFields, outputFilePaths } from "@/lib/orders/output-files";
import { createServiceSupabase } from "@/lib/supabase/service";

type Context = { params: Promise<{ id: string; orderId: string }> };
const noStore = { "Cache-Control": "private, no-store" };
/** Long enough for the website to copy the file while handling the request. */
const FILE_LINK_SECONDS = 60 * 60;

/** A member of the business and an order of that business, with its items' catalog declarations. */
async function open(request: Request, context: Context) {
  const { id: businessId, orderId } = await context.params;
  if (!isTransportId(orderId)) return { response: NextResponse.json({ error: "Porosia nuk u gjet." }, { status: 404 }) };
  const access = await transportAccess(businessId, request);
  if (!access) return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const { data: order, error } = await access.db.from("orders")
    .select("id,conversation_id,external_order_id,external_system,order_items(position,products(name,source,external_spec))")
    .eq("id", orderId).eq("business_id", businessId).maybeSingle();
  if (error) return { response: NextResponse.json({ error: "Porosia nuk u lexua." }, { status: 503 }) };
  if (!order) return { response: NextResponse.json({ error: "Porosia nuk u gjet." }, { status: 404 }) };
  const external = order.external_system === "external" && typeof order.external_order_id === "string" ? order.external_order_id : null;
  return { businessId, order, external, items: orderOutputFields(order.order_items) };
}

/**
 * The item photos of an order sent to the business website, read from the website (it keeps them):
 * the customer's and the store's own (processed design, finished product), with the store's photo fields.
 */
export async function GET(request: Request, context: Context) {
  const opened = await open(request, context);
  if ("response" in opened) return opened.response;
  const { businessId, order, external, items } = opened;
  if (!external) return NextResponse.json({ sent: false, conversationId: order.conversation_id, items }, { headers: noStore });
  const view = await fetchExternalOrder(businessId, external);
  if (!view) return NextResponse.json({ sent: true, conversationId: order.conversation_id, items, error: "Fotot nuk u lexuan nga webi i biznesit." }, { headers: noStore });
  return NextResponse.json({ sent: true, conversationId: order.conversation_id, items: items.map((item) => ({
    ...item, files: view.items.find((v) => v.item === item.item)?.files ?? [] })),
    ...(view.total !== undefined ? { websiteTotal: view.total } : {}), ...(view.shipping !== undefined ? { shipping: view.shipping } : {}) }, { headers: noStore });
}

/**
 * Adds the store's photos to one item: files already copied into the conversation's order files
 * (uploaded or chosen from the conversation). The website keeps them; Agjenti's copies are removed.
 */
export async function POST(request: Request, context: Context) {
  const opened = await open(request, context);
  if ("response" in opened) return opened.response;
  const { businessId, order, external, items } = opened;
  if (!external) return NextResponse.json({ error: "Kjo porosi nuk është te webi i biznesit." }, { status: 409 });
  const body = (await request.json().catch(() => null)) as { item?: unknown; key?: unknown; paths?: unknown } | null;
  const item = items.find((i) => i.item === body?.item);
  const field = item?.outputFields.find((f) => f.key === body?.key);
  if (!item || !field) return NextResponse.json({ error: "Kjo fushë nuk është foto e biznesit për këtë artikull." }, { status: 400 });
  const paths = outputFilePaths(body?.paths, businessId, order.conversation_id, field.max ?? 5);
  if (!paths) return NextResponse.json({ error: "Fotot nuk janë të vlefshme." }, { status: 400 });
  const storage = createServiceSupabase().storage.from(ORDER_FILES_BUCKET);
  const files = [];
  for (const path of paths) {
    const { data, error } = await storage.createSignedUrl(path, FILE_LINK_SECONDS);
    if (error || !data?.signedUrl) return NextResponse.json({ error: "Fotoja nuk u gjet. Ngarkoje përsëri." }, { status: 404 });
    files.push({ id: path.split("/").pop()!.replace(/\.[a-z]+$/, ""), url: data.signedUrl });
  }
  const sent = await sendExternalOrderFiles(businessId, external, [{ item: item.item, key: field.key, files }]);
  if (!sent.ok) return NextResponse.json({ error: `Webi i biznesit nuk e pranoi foton${sent.code ? ` (${sent.code})` : ""}.` }, { status: 502 });
  // The website keeps the files: Agjenti does not.
  await storage.remove(paths).then(() => undefined, () => undefined);
  return NextResponse.json({ sent: true, conversationId: order.conversation_id, items: items.map((i) => ({
    ...i, files: sent.view.items.find((v) => v.item === i.item)?.files ?? [] })) });
}
