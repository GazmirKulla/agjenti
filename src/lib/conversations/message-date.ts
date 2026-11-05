const timeZone = "Europe/Tirane";
/** Group and display timestamps in the same timezone, regardless of browser timezone. */
export function messageDate(timestamp: string, locale: string) {
  const date = new Date(timestamp);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const label = new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "long", year: "numeric" }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  return { day, label, time, full: `${label}, ${time}` };
}
