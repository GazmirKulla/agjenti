import { NextResponse } from "next/server";
import { isTransportId, transportAccess } from "@/lib/conversations/transport-access";
import { loadInboxVersion } from "@/lib/conversations/inbox-version";

/** A fingerprint of the Inbox so the page re-renders only when something it shows has changed. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const conversation = new URL(request.url).searchParams.get("conversation");
  if (conversation !== null && !isTransportId(conversation)) return NextResponse.json({ error: "Invalid conversation" }, { status: 400 });
  const access = await transportAccess(id, request);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const version = await loadInboxVersion(access.db, id, conversation);
    return NextResponse.json({ version }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
