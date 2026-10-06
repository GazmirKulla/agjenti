import { randomUUID } from "node:crypto";
import { catalogAccess } from "@/lib/catalogs/access";
import { createServiceSupabase } from "@/lib/supabase/service";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let path: string | null = null;
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return Response.json({ error: "Kërkesë e pavlefshme." }, { status: 403 });
    const slug = new URL(request.url).searchParams.get("slug") ?? "";
    const { business } = await catalogAccess(slug);
    const max = 10 * 1024 * 1024 + 64000;
    if (Number(request.headers.get("content-length")) > max)
      throw new Error("Maksimumi 10 MB.");
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Kërkesë bosh.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw new Error("Maksimumi 10 MB.");
      }
      chunks.push(value);
    }
    const form = await new Response(Buffer.concat(chunks), {
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
    }).formData();
    const title = String(form.get("title") ?? "")
      .trim()
      .slice(0, 180);
    if (!title) throw new Error("Vendos titullin.");
    const db = createServiceSupabase();
    const count = await db
      .from("catalogs")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business.id);
    if (count.error) throw new Error("Kontrollo migrimin e katalogëve.");
    if ((count.count ?? 0) >= 500)
      throw new Error("U arrit kufiri prej 500 dokumentesh.");
    const file = form.get("file");
    let sourceType = "url",
      sourceUrl: string | null = null;
    if (file instanceof File && file.size) {
      if (file.size > 10485760) throw new Error("Maksimumi 10 MB.");
      const bytes = Buffer.from(await file.arrayBuffer());
      const pdf = bytes.subarray(0, 5).toString() === "%PDF-";
      if (!pdf && !["text/plain", "text/markdown"].includes(file.type))
        throw new Error("Ngarko PDF, TXT ose Markdown.");
      sourceType = pdf ? "pdf" : "text";
      path = `${business.id}/${randomUUID()}.${pdf ? "pdf" : "txt"}`;
      const upload = await db.storage
        .from("business-catalogs")
        .upload(path, bytes, {
          contentType: pdf ? "application/pdf" : "text/plain",
          upsert: false,
        });
      if (upload.error) throw new Error("Ngarkimi dështoi.");
    } else {
      const rawUrl = String(form.get("url") ?? "").trim();
      if (!rawUrl || rawUrl.length > 2000)
        throw new Error(
          "Ngarko një dokument ose vendos linkun e plotë (deri 2000 karaktere).",
        );
      const url = new URL(rawUrl);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error("Link i pavlefshëm.");
      sourceUrl = url.href;
      sourceType = form.get("scan") === "on" ? "website" : "url";
    }
    const result = await db
      .from("catalogs")
      .insert({
        business_id: business.id,
        title,
        source_type: sourceType,
        source_url: sourceUrl,
        storage_path: path,
      })
      .select("id")
      .single();
    if (result.error) throw new Error("Katalogu nuk u ruajt.");
    return Response.json(
      { id: result.data.id },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (path)
      await createServiceSupabase()
        .storage.from("business-catalogs")
        .remove([path]);
    const msg = e instanceof Error ? e.message : "";
    return Response.json(
      {
        error:
          msg === "unauthorized"
            ? "Nuk ke qasje në këtë biznes."
            : msg || "Veprimi dështoi.",
      },
      { status: msg === "unauthorized" ? 403 : 400 },
    );
  }
}
