const timeZone = "Europe/Tirane";
/** Albanian month names, so the server and the browser write the same date even when
 * one of them has no Intl locale data for Albanian (a server without full ICU falls
 * back to English and the page no longer matches the browser's render). */
const SQ_MONTHS = ["janar", "shkurt", "mars", "prill", "maj", "qershor", "korrik", "gusht", "shtator", "tetor", "nëntor", "dhjetor"];
/** Group and display timestamps in the same timezone, regardless of browser timezone. */
export function messageDate(timestamp: string, locale: string) {
  const date = new Date(timestamp);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  const label = /^sq\b/i.test(locale)
    ? `${dayOfMonth} ${SQ_MONTHS[month - 1]} ${year}`
    : new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "long", year: "numeric" }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  return { day, label, time, full: `${label}, ${time}` };
}
