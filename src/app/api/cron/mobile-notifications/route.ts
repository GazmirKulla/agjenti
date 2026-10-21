import { deliverMobileNotifications } from "@/lib/mobile/notifications";
export const maxDuration = 60;
export async function GET(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await deliverMobileNotifications();
    return Response.json({ processed: true });
  } catch {
    return Response.json(
      { error: "Notification delivery failed" },
      { status: 503 },
    );
  }
}
