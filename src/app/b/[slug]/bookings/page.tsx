import { CalendarPageContent } from "@/components/calendar/page";
export const metadata = { title: "Rezervimet | Agjenti.app" };
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const [{ slug }, { date }] = await Promise.all([params, searchParams]);
  return <CalendarPageContent slug={slug} date={date} view="bookings" />;
}
