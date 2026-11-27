/** The calendar's views; the URL keeps the chosen one (?mode=). */
export const calendarModes = ["day", "week", "month", "list"] as const;
export type CalendarMode = (typeof calendarModes)[number];
export const modeViews: Record<CalendarMode, string> = { day: "timeGridDay", week: "timeGridWeek", month: "dayGridMonth", list: "listMonth" };
export const bookingStatusLabels = { pending: "Në pritje", confirmed: "Konfirmuar", cancelled: "Anuluar" } as const;
