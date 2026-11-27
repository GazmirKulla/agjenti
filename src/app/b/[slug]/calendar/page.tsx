import { CalendarPageContent } from "@/components/calendar/page";
export const metadata = { title: "Kalendari | Agjenti.app" };
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string; mode?: string; google?: string; service?: string }>;
}) {
  const [{ slug }, { date, mode, google, service }] = await Promise.all([
    params,
    searchParams,
  ]);
  return (
    <CalendarPageContent
      slug={slug}
      date={date}
      mode={mode}
      google={google}
      service={service}
      view="calendar"
    />
  );
}
