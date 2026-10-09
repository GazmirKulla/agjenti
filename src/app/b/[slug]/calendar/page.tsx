import { CalendarPageContent } from "@/components/calendar/page";
export const metadata = { title: "Kalendari | Agjenti.app" };
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string; google?: string }>;
}) {
  const [{ slug }, { date, google }] = await Promise.all([
    params,
    searchParams,
  ]);
  return (
    <CalendarPageContent
      slug={slug}
      date={date}
      google={google}
      view="calendar"
    />
  );
}
