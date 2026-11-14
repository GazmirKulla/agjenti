import { NextResponse } from "next/server";
import { isTransportId, transportAccess } from "@/lib/conversations/transport-access";
import { ORDER_FILES_BUCKET } from "@/lib/orders/dispatch";

type Context = { params: Promise<{ id: string; conversationId: string }> };
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" };

/** A reference photo the owner attaches to a manual order. Stored privately; only its path is returned. */
export async function POST(request: Request, context: Context) {
  const { id: businessId, conversationId } = await context.params;
  if (!isTransportId(conversationId)) return NextResponse.json({ error: "Biseda nuk u gjet." }, { status: 404 });
  const access = await transportAccess(businessId, request);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { data: conversation, error } = await access.db.from("conversations").select("id")
    .eq("id", conversationId).eq("business_id", businessId).maybeSingle();
  if (error) return NextResponse.json({ error: "Biseda nuk u lexua." }, { status: 503 });
  if (!conversation) return NextResponse.json({ error: "Biseda nuk u gjet." }, { status: 404 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Zgjidh një foto." }, { status: 400 });
  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "Lejohen vetëm foto JPG, PNG, WEBP ose HEIC." }, { status: 400 });
  if (!file.size || file.size > MAX_BYTES) return NextResponse.json({ error: "Fotoja duhet të jetë deri në 10 MB." }, { status: 400 });
  const path = `${businessId}/${conversationId}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await access.db.storage.from(ORDER_FILES_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (uploadError) return NextResponse.json({ error: "Fotoja nuk u ngarkua. Provo përsëri." }, { status: 503 });
  return NextResponse.json({ path });
}
