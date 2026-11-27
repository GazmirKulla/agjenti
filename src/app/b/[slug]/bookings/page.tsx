import { CalendarPageContent } from "@/components/calendar/page";
export const metadata = { title: "Rezervimet | Agjenti.app" };
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string; mode?: string; tab?: string; google?: string; service?: string }>;
}) {
  const [{ slug }, { date, mode, tab, google, service }] = await Promise.all([params, searchParams]);
  return <CalendarPageContent slug={slug} date={date} mode={mode} tab={tab} google={google} service={service} />;
}
