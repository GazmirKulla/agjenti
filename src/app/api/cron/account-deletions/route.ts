import { purgeDueAccountDeletions } from "@/lib/account/deletion";
import { trackScheduledJob } from "@/lib/tracking/system-events";
export const maxDuration = 60;
async function runJob(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await purgeDueAccountDeletions());
  } catch {
    return Response.json({ error: "Account deletion failed" }, { status: 503 });
  }
}

/** Each run is recorded in Shëndeti i Agjentit: how it ended and, when it failed, why. */
export const GET = (request: Request) => trackScheduledJob("account-deletions", () => runJob(request));
