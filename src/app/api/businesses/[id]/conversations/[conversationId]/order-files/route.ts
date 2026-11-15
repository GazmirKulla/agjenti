import { NextResponse } from "next/server";
import { isTransportId, transportAccess } from "@/lib/conversations/transport-access";
import { ORDER_FILES_BUCKET } from "@/lib/orders/dispatch";
import { listCustomerPhotos, MAX_ORDER_PHOTO_BYTES, ORDER_PHOTO_TYPES, readCustomerPhoto } from "@/lib/orders/conversation-photos";

type Context = { params: Promise<{ id: string; conversationId: string }> };
const noStore = { "Cache-Control": "private, no-store" };

/** Same checks for every method: a member of the business and a conversation of that business. */
async function open(request: Request, context: Context) {
  const { id: businessId, conversationId } = await context.params;
  if (!isTransportId(conversationId)) return { response: NextResponse.json({ error: "Biseda nuk u gjet." }, { status: 404 }) };
  const access = await transportAccess(businessId, request);
  if (!access) return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const { data: conversation, error } = await access.db.from("conversations").select("id")
    .eq("id", conversationId).eq("business_id", businessId).maybeSingle();
  if (error) return { response: NextResponse.json({ error: "Biseda nuk u lexua." }, { status: 503 }) };
  if (!conversation) return { response: NextResponse.json({ error: "Biseda nuk u gjet." }, { status: 404 }) };
  return { access, businessId, conversationId };
}

/**
 * Photos the customer sent in the conversation, to choose from in the order form:
 * without `photo` the list, with `photo=<id>` that photo's bytes (for the preview).
 */
export async function GET(request: Request, context: Context) {
  const opened = await open(request, context);
  if ("response" in opened) return opened.response;
  const { access, businessId, conversationId } = opened;
  const photo = new URL(request.url).searchParams.get("photo");
  if (!photo) {
    const photos = await listCustomerPhotos(access.db, businessId, conversationId);
    if (!photos) return NextResponse.json({ error: "Fotot e bisedës nuk u lexuan." }, { status: 503 });
    return NextResponse.json({ photos }, { headers: noStore });
  }
  const read = await readCustomerPhoto(access.db, businessId, conversationId, photo.slice(0, 80));
  if ("error" in read) return NextResponse.json({ error: read.error }, { status: read.status });
  return new Response(new Uint8Array(read.bytes), {
    headers: { "Content-Type": read.type, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" },
  });
}

/**
 * A reference photo for a manual order, stored privately; only its path is returned.
 * Either uploaded by the owner (multipart `file`) or copied from the conversation (JSON `{ photoId }`),
 * so the website gets a lasting link instead of the channel's expiring one.
 */
export async function POST(request: Request, context: Context) {
  const opened = await open(request, context);
  if ("response" in opened) return opened.response;
  const { access, businessId, conversationId } = opened;
  let bytes: Buffer, type: string;
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { photoId?: unknown } | null;
    if (typeof body?.photoId !== "string") return NextResponse.json({ error: "Zgjidh një foto." }, { status: 400 });
    const read = await readCustomerPhoto(access.db, businessId, conversationId, body.photoId.slice(0, 80));
    if ("error" in read) return NextResponse.json({ error: read.error }, { status: read.status });
    ({ bytes, type } = read);
  } else {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Zgjidh një foto." }, { status: 400 });
    if (!ORDER_PHOTO_TYPES[file.type]) return NextResponse.json({ error: "Lejohen vetëm foto JPG, PNG, WEBP ose HEIC." }, { status: 400 });
    if (!file.size || file.size > MAX_ORDER_PHOTO_BYTES) return NextResponse.json({ error: "Fotoja duhet të jetë deri në 10 MB." }, { status: 400 });
    bytes = Buffer.from(await file.arrayBuffer());
    type = file.type;
  }
  const path = `${businessId}/${conversationId}/${crypto.randomUUID()}.${ORDER_PHOTO_TYPES[type]}`;
  const { error: uploadError } = await access.db.storage.from(ORDER_FILES_BUCKET).upload(path, bytes, { contentType: type, upsert: false });
  if (uploadError) return NextResponse.json({ error: "Fotoja nuk u ngarkua. Provo përsëri." }, { status: 503 });
  return NextResponse.json({ path }, { headers: noStore });
}
