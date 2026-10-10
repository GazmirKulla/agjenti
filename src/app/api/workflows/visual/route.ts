import { mutateVisualWorkflow } from "@/lib/workflows/visual/save-service";
import { unconfirmedSaveMessage } from "@/lib/workflows/visual/save-result";
import type { WorkflowOperation } from "@/lib/workflows/visual/mutations";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const operations = new Set<WorkflowOperation>(["draft", "publish", "enable", "disable"]);

/** Stable URL: an editor left open across a deployment can still save its draft. */
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return json({ error: "Kërkesë e palejuar." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return json({ error: "Kërkesë e pavlefshme." }, 400);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "Mungon kërkesa." }, 400);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let body;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 256_000) { await reader.cancel(); return json({ error: "Rrjedha është shumë e gjatë." }, 413); }
      chunks.push(value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return json({ error: "Kërkesë e pavlefshme." }, 400); }
  finally { reader.releaseLock(); }
  if (!body || typeof body !== "object" || typeof body.slug !== "string" || !body.slug || body.slug.length > 200 ||
      !Number.isInteger(body.revision) || body.revision < 0 || !operations.has(body.operation))
    return json({ error: "Kërkesë e pavlefshme." }, 400);
  try {
    return json(await mutateVisualWorkflow(body.slug, body.revision, body.graph, body.operation));
  } catch {
    // The request may have committed before the connection failed. Never retry
    // automatically or tell the editor that its local changes were discarded.
    return json({ error: unconfirmedSaveMessage }, 503);
  }
}
