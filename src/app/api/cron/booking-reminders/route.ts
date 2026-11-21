import { sendBookingReminders } from "@/lib/calendar/notices";
import { trackScheduledJob } from "@/lib/tracking/system-events";
export const maxDuration = 60;
/**
 * Each morning: a reminder for the bookings of the day that were made in a conversation, sent only while the
 * customer's 24-hour messaging window is open (no message tags or templates). The rest are skipped and counted.
 */
async function runJob(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try { return Response.json(await sendBookingReminders()); }
  catch { return Response.json({ error: "Kujtesat nuk u dërguan." }, { status: 503 }); }
}

/** Each run is recorded in Shëndeti i Agjentit: how it ended and, when it failed, why. */
export const GET = (request: Request) => trackScheduledJob("booking-reminders", () => runJob(request));
