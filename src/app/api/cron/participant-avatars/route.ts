import { NextResponse } from "next/server";
import { runAvatarBackfill } from "@/lib/conversations/avatar-backfill";
import { createServiceSupabase } from "@/lib/supabase/service";
import { trackScheduledJob } from "@/lib/tracking/system-events";

export const maxDuration = 180;

function isAuthorizedCron(request: Request): boolean {
	const secret = process.env.CRON_SECRET?.trim();
	if (!secret) return false;
	return request.headers.get("authorization") === `Bearer ${secret}`;
}

/** Daily: profile photos for contacts who have not written since their photo was last checked. */
async function runJob(request: Request) {
	if (!isAuthorizedCron(request)) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	try {
		const summary = await runAvatarBackfill(createServiceSupabase(), { budgetMs: 150_000 });
		console.log("[cron participant-avatars]", summary);
		return NextResponse.json({ ok: true, ...summary });
	} catch (error) {
		console.error("[cron participant-avatars]", error instanceof Error ? error.message : error);
		return NextResponse.json({ ok: false }, { status: 503 });
	}
}

/** Each run is recorded in Shëndeti i Agjentit: how it ended and, when it failed, why. */
export const GET = (request: Request) => trackScheduledJob("participant-avatars", () => runJob(request));
