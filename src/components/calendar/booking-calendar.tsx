"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import FullCalendar, { type CalendarRef, type DateClickInfo, type DatesSetInfo, type EventClickInfo, type EventDisplayInfo, type EventDropInfo, type EventInput } from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import listPlugin from "@fullcalendar/react/list";
import interactionPlugin from "@fullcalendar/react/interaction";
import breezyTheme from "@fullcalendar/react/themes/breezy";
import sqLocale from "@fullcalendar/react/locales/sq";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/breezy/theme.css";
import "@fullcalendar/react/themes/breezy/palettes/emerald.css";
import { changeBooking, readCalendarEvents } from "@/lib/calendar/actions";
import { dayNames, zonedParts, type CalendarSettings } from "@/lib/calendar/model";
import type { CalendarBooking } from "@/lib/calendar/service";
import { bookingStatusLabels, modeViews, type CalendarMode } from "./booking-calendar-modes";

const modeLabels: Record<CalendarMode, string> = { day: "Dita", week: "Java", month: "Muaji", list: "Lista" };

/** Wall-clock date and time in the calendar's zone, read from FullCalendar's ISO string (offset included). */
function wallClock(iso: string) {
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const timeFormat = { hour: "2-digit", minute: "2-digit", hour12: false } as const;
const locales = [sqLocale];
const plugins = [timeGridPlugin, dayGridPlugin, listPlugin, interactionPlugin, breezyTheme];
// Albanian names written out: some browsers (and WebViews) have no Albanian date data and fall back to English.
const months = ["janar", "shkurt", "mars", "prill", "maj", "qershor", "korrik", "gusht", "shtator", "tetor", "nëntor", "dhjetor"];
const shortDays = ["Die", "Hën", "Mar", "Mër", "Enj", "Pre", "Sht"];
type Zoned = { year: number; month: number; day: number };
const weekday = (d: Zoned) => new Date(Date.UTC(d.year, d.month, d.day)).getUTCDay();
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const fmt = {
  month: ({ date }: { date: Zoned }) => `${capital(months[date.month])} ${date.year}`,
  day: ({ date }: { date: Zoned }) => `${dayNames[weekday(date)]}, ${date.day} ${months[date.month]} ${date.year}`,
  range: ({ start, end }: { start: Zoned; end?: Zoned | null }) => {
    if (!end) return `${start.day} ${months[start.month]} ${start.year}`;
    const from = start.month === end.month ? `${start.day}` : start.year === end.year ? `${start.day} ${months[start.month]}` : `${start.day} ${months[start.month]} ${start.year}`;
    return `${from} – ${end.day} ${months[end.month]} ${end.year}`;
  },
  header: ({ date }: { date: Zoned }) => `${shortDays[weekday(date)]} ${date.day}`,
  weekday: ({ date }: { date: Zoned }) => shortDays[weekday(date)],
  listDay: ({ date }: { date: Zoned }) => `${dayNames[weekday(date)]}, ${date.day} ${months[date.month]}`,
};
const views = {
  timeGridDay: { titleFormat: fmt.day, dayHeaderFormat: fmt.header },
  timeGridWeek: { titleFormat: fmt.range, dayHeaderFormat: fmt.header },
  dayGridMonth: { titleFormat: fmt.month, dayHeaderFormat: fmt.weekday },
  listMonth: { titleFormat: fmt.month, listDayFormat: fmt.listDay, listDayAltFormat: false as const },
};
const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}:00`;

export function BookingCalendar({
  slug,
  settings,
  date,
  mode,
  refreshKey,
  onOpen,
  onCreate,
  onChanged,
}: {
  slug: string;
  settings: CalendarSettings;
  date: string;
  mode: CalendarMode;
  /** Changes when a booking was saved elsewhere on the page: the calendar reloads its range. */
  refreshKey: number;
  onOpen: (booking: CalendarBooking) => void;
  onCreate: (at: { date: string; time?: string }) => void;
  onChanged: () => void;
}) {
  const ref = useRef<CalendarRef>(null);
  const [current, setCurrent] = useState<CalendarMode>(mode);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  // FullCalendar calls some handlers while React renders, sometimes before this component has mounted:
  // their state changes wait until it has, then run on the next task.
  const mounted = useRef(false);
  const queued = useRef<(() => void)[]>([]);
  const later = useRef((update: () => void) => {
    if (mounted.current) setTimeout(update, 0);
    else queued.current.push(update);
  }).current;
  useEffect(() => {
    mounted.current = true;
    queued.current.splice(0).forEach(update => update());
    return () => { mounted.current = false; };
  }, []);

  // Phones open the day view unless the URL asked for another one.
  useEffect(() => {
    if (mode === "week" && window.matchMedia("(max-width: 640px)").matches) change("day");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const api = () => ref.current?.getApi();
  function change(next: CalendarMode) {
    setCurrent(next);
    api()?.changeView(modeViews[next]);
  }

  // Working hours shape the grid; an hour of margin keeps early and late bookings visible.
  const range = useMemo(() => {
    if (!settings.hours.length) return { min: "07:00:00", max: "21:00:00" };
    const start = Math.max(0, Math.min(...settings.hours.map(h => minutes(h.start))) - 60);
    const end = Math.min(24 * 60, Math.max(...settings.hours.map(h => minutes(h.end))) + 60);
    return { min: clock(Math.floor(start / 60) * 60), max: clock(Math.ceil(end / 60) * 60) };
  }, [settings.hours]);
  const businessHours = useMemo(
    () => settings.hours.map(h => ({ daysOfWeek: [h.day], startTime: h.start, endTime: h.end })),
    [settings.hours],
  );

  // FullCalendar re-applies options that change identity, so every handler is created once and reads
  // the latest props through this ref.
  const latest = useRef({ slug, settings, date, current, showCancelled, onOpen, onCreate, onChanged });
  latest.current = { slug, settings, date, current, showCancelled, onOpen, onCreate, onChanged };
  const handlers = useMemo(() => ({
    datesSet(info: DatesSetInfo) {
      const visible = { start: info.startStr, end: info.endStr };
      later(() => setVisible(current => current?.start === visible.start && current.end === visible.end ? current : visible));
      const shown = { title: info.view.title, type: info.view.type, start: ref.current?.getApi().formatIso(info.view.currentStart, true) ?? latest.current.date };
      later(() => {
        setTitle(shown.title);
        const url = new URL(window.location.href);
        url.searchParams.set("date", shown.start);
        url.searchParams.set("mode", (Object.keys(modeViews) as CalendarMode[]).find(m => modeViews[m] === shown.type) ?? latest.current.current);
        if (url.href !== window.location.href) window.history.replaceState(null, "", url);
      });
    },
    eventClick(info: EventClickInfo) {
      const booking = info.event.extendedProps.booking as CalendarBooking | undefined;
      if (booking) { info.jsEvent.preventDefault(); latest.current.onOpen(booking); }
    },
    dateClick(info: DateClickInfo) {
      const at = wallClock(info.dateStr);
      latest.current.onCreate(info.allDay ? { date: at.date } : at);
    },
    async eventDrop(info: EventDropInfo) {
      const booking = info.event.extendedProps.booking as CalendarBooking | undefined;
      if (!booking) return info.revert();
      setNotice(null);
      const result = await changeBooking(latest.current.slug, { id: booking.id, revision: booking.revision, ...wallClock(info.event.startStr) });
      if (result.error) {
        info.revert();
        setNotice({ kind: "error", text: result.error });
      } else {
        setNotice({ kind: "success", text: result.success ?? "Rezervimi u zhvendos." });
        setReload(n => n + 1);
        latest.current.onChanged();
      }
    },
    eventContent(arg: EventDisplayInfo) {
      const booking = arg.event.extendedProps.booking as CalendarBooking | undefined;
      if (!booking) return null;
      const label = `${arg.timeText}, ${booking.customer_name}, ${booking.service_name}, ${bookingStatusLabels[booking.status]}`;
      return (
        <div className={`booking-event-body ${arg.isShort ? "is-short" : ""}`} title={label}>
          <strong><span>{zonedParts(booking.starts_at, latest.current.settings.timezone).time}</span> {booking.customer_name}</strong>
          <span>{booking.service_name}</span>
          {!arg.isShort && booking.status !== "confirmed" && <small>{bookingStatusLabels[booking.status]}</small>}
        </div>
      );
    },
  }), [later]);

  // The visible range is loaded here, after FullCalendar reports it, rather than through FullCalendar's
  // own event source: that one is called on every render, before the calendar has even mounted.
  const [visible, setVisible] = useState<{ start: string; end: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [loaded, setLoaded] = useState<{ bookings: CalendarBooking[]; busy: { start: string; end: string }[] }>({ bookings: [], busy: [] });
  // A change saved elsewhere on the page makes an earlier calendar message stale.
  useEffect(() => { if (refreshKey) setNotice(null); }, [refreshKey]);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setLoading(true);
    // A day of margin on each side covers any difference between the browser's zone and the business's.
    const start = new Date(Date.parse(visible.start) - 86400000).toISOString();
    const end = new Date(Date.parse(visible.end) + 86400000).toISOString();
    readCalendarEvents(slug, start, end).then(result => {
      if (!active) return;
      setLoaded({ bookings: result.bookings, busy: result.busy });
      if (result.googleError) setNotice({ kind: "error", text: result.googleError });
    }).catch(error => {
      if (active) setNotice({ kind: "error", text: error instanceof Error ? error.message : "Kalendari nuk u ngarkua." });
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug, visible, reload, refreshKey]);
  const events = useMemo<EventInput[]>(() => [
    ...loaded.bookings
      .filter(b => showCancelled || b.status !== "cancelled")
      .map(b => ({
        id: b.id,
        title: b.customer_name,
        start: b.starts_at,
        end: b.ends_at,
        className: `booking-event is-${b.status}`,
        startEditable: b.status !== "cancelled" && Date.parse(b.starts_at) > Date.now(),
        durationEditable: false,
        extendedProps: { booking: b },
      })),
    ...loaded.busy.map((b, i) => ({
      id: `google-${i}`, start: b.start, end: b.end, display: "background", className: "booking-busy", title: "Google",
    })),
    ...settings.closed_dates.map(d => ({
      id: `closed-${d}`, start: d, allDay: true, display: "background", className: "booking-closed", title: "Mbyllur",
    })),
  ], [loaded, showCancelled, settings.closed_dates]);

  return (
    <section className="booking-calendar panel" aria-label="Kalendari i rezervimeve">
      <div className="booking-calendar-toolbar">
        <div className="booking-calendar-nav">
          <button type="button" className="btn btn-ghost btn-small" onClick={() => api()?.today()}>Sot</button>
          <button type="button" className="btn btn-ghost btn-small" aria-label="Periudha e kaluar" onClick={() => api()?.prev()}>‹</button>
          <button type="button" className="btn btn-ghost btn-small" aria-label="Periudha tjetër" onClick={() => api()?.next()}>›</button>
          <h2 aria-live="polite">{title}</h2>
          {loading && <span className="booking-calendar-loading" role="status">Po ngarkohet…</span>}
        </div>
        <div className="booking-calendar-modes" role="group" aria-label="Pamja">
          {(Object.keys(modeLabels) as CalendarMode[]).map(m => (
            <button key={m} type="button" className={`btn btn-small ${current === m ? "is-active" : "btn-ghost"}`}
              aria-pressed={current === m} onClick={() => change(m)}>{modeLabels[m]}</button>
          ))}
        </div>
      </div>
      <div className="booking-calendar-meta">
        <span className="booking-legend is-confirmed">Konfirmuar</span>
        <span className="booking-legend is-pending">Në pritje</span>
        <span className="booking-legend is-busy">E zënë në Google</span>
        <label className="booking-calendar-toggle">
          <input type="checkbox" checked={showCancelled} onChange={e => setShowCancelled(e.target.checked)} /> Shfaq të anuluarat
        </label>
        <span className="muted-copy">{settings.timezone}</span>
      </div>
      {notice && (
        <p className={`calendar-notice ${notice.kind === "error" ? "is-error" : ""}`} role={notice.kind === "error" ? "alert" : "status"}>
          {notice.text}
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setNotice(null)}>Mbyll</button>
        </p>
      )}
      <FullCalendar
        ref={ref}
        plugins={plugins}
        locales={locales}
        locale="sq"
        timeZone={settings.timezone}
        initialView={modeViews[mode]}
        initialDate={date}
        headerToolbar={false}
        views={views}
        height="auto"
        allDaySlot={false}
        nowIndicator
        slotMinTime={range.min}
        slotMaxTime={range.max}
        slotDuration="00:30:00"
        slotMinHeight={44}
        snapDuration="00:15:00"
        scrollTime={range.min}
        businessHours={businessHours}
        dayMaxEvents={3}
        eventOverlap={false}
        slotHeaderFormat={timeFormat}
        eventTimeFormat={timeFormat}
        events={events}
        datesSet={handlers.datesSet}
        eventClick={handlers.eventClick}
        dateClick={handlers.dateClick}
        eventDrop={handlers.eventDrop}
        eventContent={handlers.eventContent}
      />
    </section>
  );
}
