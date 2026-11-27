import { redirect } from "next/navigation";

/** The calendar is part of Rezervimet; older links (Google's return, services, the home page) keep working. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const next = new URLSearchParams();
  for (const key of ["date", "mode", "tab", "google", "service"]) {
    const value = query[key];
    if (typeof value === "string" && value) next.set(key, value);
  }
  // The calendar page opened on the week; keep that for links that did not say otherwise.
  if (!next.has("mode") && !next.has("google") && next.get("tab") !== "settings") next.set("mode", "week");
  redirect(`/b/${encodeURIComponent(slug)}/bookings${next.size ? `?${next}` : ""}`);
}
