"use server";
import { randomUUID } from "node:crypto";
import { manualCommandActor } from "@/lib/actions/command-actor";
import { createServiceSupabase } from "@/lib/supabase/service";

const BUCKET = "product-images";
/** Server actions accept 2 MB bodies; the form shrinks photos before sending. */
const MAX_BYTES = 1_900_000;
const TYPES: Record<string, { ext: string; magic: (b: Uint8Array) => boolean }> = {
  "image/jpeg": { ext: "jpg", magic: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { ext: "png", magic: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  "image/webp": { ext: "webp", magic: b => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP" },
};

/**
 * Stores a product photo under the business's folder and returns its public link, which the
 * form puts in image_url. The product itself is saved only when the form is saved.
 */
export async function uploadProductImage(slug: string, formData: FormData): Promise<{ url: string } | { error: string }> {
  let businessId: string;
  try { businessId = (await manualCommandActor(slug)).business.id; }
  catch (error) { return { error: (error as Error).message }; }
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Zgjidh një foto." };
  const type = TYPES[file.type];
  if (!type) return { error: "Fotoja duhet të jetë JPG, PNG ose WebP." };
  if (file.size > MAX_BYTES) return { error: "Fotoja është shumë e madhe. Provo një foto më të vogël." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!type.magic(bytes)) return { error: "Skedari nuk është foto e vlefshme." };
  const db = createServiceSupabase();
  const path = `${businessId}/${randomUUID()}.${type.ext}`;
  let upload = await db.storage.from(BUCKET).upload(path, bytes, { contentType: file.type, cacheControl: "31536000", upsert: false });
  if (upload.error && (await db.storage.getBucket(BUCKET)).error) {
    // Before the migration runs: the same public bucket it creates.
    await db.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 5242880, allowedMimeTypes: Object.keys(TYPES) });
    upload = await db.storage.from(BUCKET).upload(path, bytes, { contentType: file.type, cacheControl: "31536000", upsert: false });
  }
  if (upload.error) return { error: "Fotoja nuk u ngarkua. Provo përsëri." };
  return { url: db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl };
}
