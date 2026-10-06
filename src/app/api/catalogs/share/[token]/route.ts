import { createServiceSupabase } from "@/lib/supabase/service";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token))
    return new Response("Nuk u gjet.", { status: 404 });
  const db = createServiceSupabase();
  const { data } = await db
    .from("catalogs")
    .select("storage_path,source_url")
    .eq("share_token", token)
    .eq("active", true)
    .eq("index_status", "ready")
    .not("confirmed_at", "is", null)
    .maybeSingle();
  if (!data)
    return new Response("Katalogu nuk është i disponueshëm.", { status: 404 });
  let target = data.source_url;
  if (data.storage_path) {
    const signed = await db.storage
      .from("business-catalogs")
      .createSignedUrl(data.storage_path, 60, { download: true });
    target = signed.data?.signedUrl;
  }
  if (!target || !/^https?:\/\//i.test(target))
    return new Response("Nuk u hap.", { status: 404 });
  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
