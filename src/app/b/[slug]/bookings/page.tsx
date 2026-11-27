import { CalendarPageContent } from "@/components/calendar/page";
export const metadata = { title: "Rezervimet | Agjenti.app" };
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string; mode?: string }>;
}) {
  const [{ slug }, { date, mode }] = await Promise.all([params, searchParams]);
  return <CalendarPageContent slug={slug} date={date} mode={mode} view="bookings" />;
}
