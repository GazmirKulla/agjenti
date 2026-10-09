"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ActionForm } from "@/components/dashboard/action-form";
import {
  saveCalendarSettings,
  saveBooking,
  retryBookingSync,
  selectGoogleCalendar,
  disconnectGoogleCalendar,
} from "@/lib/calendar/actions";
import {
  dayNames,
  overlaps,
  slotCandidates,
  zonedParts,
  type Booking,
  type Hours,
} from "@/lib/calendar/model";
import type { CalendarData } from "@/lib/calendar/service";
import "./calendar.css";
const statusLabels = {
  pending: "Në pritje",
  confirmed: "Konfirmuar",
  cancelled: "Anuluar",
};
const syncLabels = {
  local: "Në panel",
  pending: "Në pritje të Google",
  synced: "Sinkronizuar",
  error: "Google kërkon riprovim",
};
function BookingFields({
  data,
  date,
  booking,
  initialService,
}: {
  data: CalendarData;
  date: string;
  booking?: Booking;
  initialService?: string;
}) {
  const initial = booking
    ? zonedParts(booking.starts_at, data.settings.timezone)
    : { date, time: "" };
  const [selectedDate, setDate] = useState(initial.date),
    [serviceId, setService] = useState(
      booking?.service_id ??
        initialService ??
        data.services.find((s) => s.is_active && s.booking_enabled !== false)
          ?.id ??
        "",
    );
  const [requestKey, setRequestKey] = useState("");
  useEffect(() => {
    setRequestKey(crypto.randomUUID());
  }, []);
  const service = data.services.find((s) => s.id === serviceId);
  const options = service
    ? slotCandidates(selectedDate, service, data.settings).filter(
        (slot) =>
          !data.bookings
            .filter((b) => b.id !== booking?.id && b.status !== "cancelled")
            .some((b) =>
              overlaps(
                slot.start,
                slot.blockedUntil,
                b.starts_at,
                b.blocked_until,
              ),
            ),
      )
    : [];
  // Google availability is checked again server-side, including on edits.
  return (
    <div className="calendar-form-grid">
      {booking ? (
        <>
          <input type="hidden" name="id" value={booking.id} />
          <input type="hidden" name="revision" value={booking.revision} />
        </>
      ) : (
        <input type="hidden" name="requestKey" value={requestKey} />
      )}
      <label>
        Shërbimi
        <select
          className="field"
          name="service"
          required
          value={serviceId}
          onChange={(e) => setService(e.target.value)}
        >
          {data.services
            .filter(
              (s) =>
                (s.is_active && s.booking_enabled !== false) ||
                s.id === booking?.service_id,
            )
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.duration_minutes} min
              </option>
            ))}
        </select>
      </label>
      <label>
        Klienti
        <input
          className="field"
          name="name"
          required
          minLength={2}
          maxLength={120}
          defaultValue={booking?.customer_name}
        />
      </label>
      <label>
        Telefon ose kontakt
        <input
          className="field"
          name="contact"
          maxLength={200}
          defaultValue={booking?.customer_contact}
        />
      </label>
      <label>
        Data
        <input
          className="field"
          type="date"
          name="date"
          required
          value={selectedDate}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <label>
        Ora
        <input
          className="field"
          type="time"
          name="time"
          required
          defaultValue={initial.time}
          list={booking ? `times-${booking.id}` : "booking-times"}
        />
        <datalist id={booking ? `times-${booking.id}` : "booking-times"}>
          {options.map((slot) => (
            <option
              key={slot.start}
              value={zonedParts(slot.start, data.settings.timezone).time}
            />
          ))}
        </datalist>
      </label>
      <label>
        Statusi
        <select
          className="field"
          name="status"
          defaultValue={booking?.status ?? "confirmed"}
        >
          {Object.entries(statusLabels)
            .filter(([key]) => booking || key !== "cancelled")
            .map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
        </select>
      </label>
      <label className="calendar-wide">
        Shënime
        <textarea
          className="field"
          name="notes"
          rows={2}
          maxLength={1000}
          defaultValue={booking?.notes}
        />
      </label>
      <p className="muted-copy calendar-wide">
        {data.settings.timezone} · Orari kontrollohet para ruajtjes. Pushimi pas
        takimit zë gjithashtu kalendarin.
      </p>
      <button className="btn btn-primary" type="submit">
        {booking ? "Ruaj ndryshimet" : "Shto rezervimin"}
      </button>
    </div>
  );
}
function HoursEditor({ initial }: { initial: Hours[] }) {
  const [hours, setHours] = useState(initial);
  const update = (index: number, field: "start" | "end", value: string) =>
    setHours((current) =>
      current.map((h, i) => (i === index ? { ...h, [field]: value } : h)),
    );
  return (
    <div className="calendar-hours">
      <input type="hidden" name="hours" value={JSON.stringify(hours)} />
      {dayNames.map((name, day) => (
        <div className="calendar-hours-day" key={day}>
          <strong>{name}</strong>
          <div>
            {hours.map((h, index) =>
              h.day === day ? (
                <div className="calendar-hours-interval" key={index}>
                  <input
                    className="field"
                    type="time"
                    aria-label={`Hapja ${name}`}
                    required
                    value={h.start}
                    onChange={(e) => update(index, "start", e.target.value)}
                  />
                  <span>–</span>
                  <input
                    className="field"
                    type="time"
                    aria-label={`Mbyllja ${name}`}
                    required
                    value={h.end}
                    onChange={(e) => update(index, "end", e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    aria-label={`Hiq intervalin ${name}`}
                    onClick={() =>
                      setHours((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }
                  >
                    ×
                  </button>
                </div>
              ) : null,
            )}
            {!hours.some((h) => h.day === day) && (
              <small className="muted-copy">Mbyllur</small>
            )}
          </div>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() =>
              setHours((current) => [
                ...current,
                { day, start: "09:00", end: "17:00" },
              ])
            }
          >
            + Orar
          </button>
        </div>
      ))}
    </div>
  );
}
export function CalendarWorkspace({
  data,
  slug,
  date,
  days,
  view,
  googleConfigured,
  googleNotice,
  initialService,
}: {
  data: CalendarData;
  slug: string;
  date: string;
  days: string[];
  view: "calendar" | "bookings";
  googleConfigured: boolean;
  googleNotice?: string;
  initialService?: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(Boolean(initialService));
  const changeDate = (value: string) => {
    if (value)
      router.push(`/b/${slug}/${view}?date=${encodeURIComponent(value)}`);
  };
  const moveWeek = (delta: number) => {
    const at = new Date(`${date}T12:00Z`);
    at.setUTCDate(at.getUTCDate() + delta);
    changeDate(at.toISOString().slice(0, 10));
  };
  const refresh = () => router.refresh();
  const selected = data.bookings.filter(
    (b) => zonedParts(b.starts_at, data.settings.timezone).date === date,
  );
  return (
    <div className="calendar-workspace">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">TAKIMET E BIZNESIT</p>
          <h1>{view === "calendar" ? "Kalendari" : "Rezervimet"}</h1>
          <p className="page-description">
            Shërbimet, oraret dhe takimet në një vend.
          </p>
        </div>
        <button
          className="btn btn-primary"
          disabled={
            !data.services.some(
              (s) => s.is_active && s.booking_enabled !== false,
            )
          }
          onClick={() => setAdding(!adding)}
        >
          {adding ? "Mbyll formularin" : "+ Shto rezervim"}
        </button>
      </div>
      {!data.available ? (
        <section className="panel section-pad" role="status">
          Kalendari kërkon përditësimin e databazës. Administratori duhet të
          aplikojë migrimin e kalendarit.
        </section>
      ) : (
        <>
          {googleNotice && (
            <p className="calendar-notice" role="status">
              {googleNotice}
            </p>
          )}
          {data.googleError && (
            <p className="calendar-notice" role="alert">
              {data.googleError}
            </p>
          )}
          {!data.services.some(
            (s) => s.is_active && s.booking_enabled !== false,
          ) && (
            <p className="calendar-notice">
              Për të filluar, aktivizo rezervimin me orar te{" "}
              <Link href={`/b/${slug}/services`}>Shërbimet</Link>.
            </p>
          )}
          <div className="calendar-toolbar">
            <div>
              <button
                className="btn btn-ghost"
                aria-label="Java e kaluar"
                onClick={() => moveWeek(-7)}
              >
                ←
              </button>
              <button
                className="btn btn-ghost"
                aria-label="Java e ardhshme"
                onClick={() => moveWeek(7)}
              >
                →
              </button>
            </div>
            <label>
              Data{" "}
              <input
                className="field"
                type="date"
                value={date}
                onChange={(e) => changeDate(e.target.value)}
              />
            </label>
            <span className="muted-copy">{data.settings.timezone}</span>
            <button className="btn btn-ghost" onClick={refresh}>
              Rifresko
            </button>
          </div>
          {adding && (
            <section className="panel section-pad">
              <h2>Rezervim i ri</h2>
              <ActionForm
                action={saveBooking.bind(null, slug)}
                onSuccess={() => {
                  setAdding(false);
                  refresh();
                }}
              >
                <BookingFields
                  data={data}
                  date={date}
                  initialService={initialService}
                />
              </ActionForm>
            </section>
          )}
          {view === "calendar" && (
            <section className="calendar-week" aria-label="Takimet e javës">
              {days.map((day) => {
                const appointments = data.bookings.filter(
                  (b) =>
                    b.status !== "cancelled" &&
                    zonedParts(b.starts_at, data.settings.timezone).date ===
                      day,
                );
                const busy = data.busy.filter((b) => {
                  const start = zonedParts(
                      b.start,
                      data.settings.timezone,
                    ).date,
                    end = zonedParts(b.end, data.settings.timezone).date;
                  return start <= day && end >= day;
                });
                return (
                  <div
                    className={`calendar-day ${day === date ? "is-selected" : ""}`}
                    key={day}
                  >
                    <button
                      className="calendar-day-heading"
                      aria-pressed={day === date}
                      onClick={() => changeDate(day)}
                    >
                      <span>
                        {dayNames[new Date(`${day}T12:00Z`).getUTCDay()]}
                      </span>
                      <strong>
                        {day.slice(8)}.{day.slice(5, 7)}
                      </strong>
                    </button>
                    {appointments.map((b) => (
                      <button
                        className={`calendar-event is-${b.status}`}
                        key={b.id}
                        onClick={() => changeDate(day)}
                      >
                        <strong>
                          {zonedParts(b.starts_at, data.settings.timezone).time}{" "}
                          – {zonedParts(b.ends_at, data.settings.timezone).time}
                        </strong>
                        <span>{b.service_name}</span>
                        <small>
                          {b.customer_name} · {statusLabels[b.status]}
                        </small>
                      </button>
                    ))}
                    {!!busy.length && (
                      <p className="calendar-busy">
                        Google: {busy.length} intervale të zëna
                      </p>
                    )}
                    {!appointments.length && !busy.length && (
                      <p className="calendar-empty">Pa takime</p>
                    )}
                  </div>
                );
              })}
            </section>
          )}
          <section className="panel section-pad">
            <h2>Takimet · {date}</h2>
            {!selected.length ? (
              <p className="muted-copy">Nuk ka rezervime për këtë ditë.</p>
            ) : (
              selected.map((booking) => (
                <article
                  className="calendar-booking"
                  key={`${booking.id}-${booking.revision}`}
                >
                  <div className="calendar-booking-summary">
                    <div>
                      <strong>
                        {
                          zonedParts(booking.starts_at, data.settings.timezone)
                            .time
                        }{" "}
                        · {booking.service_name}
                      </strong>
                      <p>
                        {booking.customer_name}
                        {booking.customer_contact
                          ? ` · ${booking.customer_contact}`
                          : ""}
                      </p>
                    </div>
                    <div>
                      <span className={`calendar-badge is-${booking.status}`}>
                        {statusLabels[booking.status]}
                      </span>
                      <small>{syncLabels[booking.sync_status]}</small>
                    </div>
                  </div>
                  {booking.status !== "cancelled" && (
                    <details>
                      <summary>Ndrysho / Anulo</summary>
                      <ActionForm
                        action={saveBooking.bind(null, slug)}
                        onSuccess={refresh}
                      >
                        <BookingFields
                          data={data}
                          date={date}
                          booking={booking}
                        />
                      </ActionForm>
                    </details>
                  )}
                  {["error", "pending"].includes(booking.sync_status) && (
                    <ActionForm
                      action={retryBookingSync.bind(null, slug)}
                      onSuccess={refresh}
                    >
                      <input type="hidden" name="id" value={booking.id} />
                      <button className="btn btn-ghost">Riprovo Google</button>
                    </ActionForm>
                  )}
                </article>
              ))
            )}
          </section>
          <details className="panel section-pad calendar-settings">
            <summary>Konfigurimi i kalendarit</summary>
            <section>
              <h2>Shërbimet që rezervohen</h2>
              <p className="muted-copy">
                Përcakto kohëzgjatjen për çdo shërbim. Kalendari pranon një
                takim në të njëjtën kohë.
              </p>
              <Link className="btn btn-ghost" href={`/b/${slug}/services`}>
                Menaxho shërbimet
              </Link>
            </section>
            <section>
              <h2>Orari i punës</h2>
              <ActionForm
                action={saveCalendarSettings.bind(null, slug)}
                onSuccess={refresh}
              >
                <div className="calendar-form-grid">
                  <label>
                    Zona kohore
                    <input
                      className="field"
                      name="timezone"
                      required
                      defaultValue={data.settings.timezone}
                      placeholder="Europe/Tirane"
                    />
                  </label>
                  <label>
                    Konfirmimi nga Agjenti
                    <select
                      className="field"
                      name="confirmationMode"
                      defaultValue={data.settings.confirmation_mode}
                    >
                      <option value="manual">Me miratim nga biznesi</option>
                      <option value="automatic">
                        Automatik, pas konfirmimit të klientit
                      </option>
                    </select>
                  </label>
                </div>
                <HoursEditor initial={data.settings.hours} />
                <label className="calendar-field">
                  Ditët e mbyllura
                  <textarea
                    className="field"
                    name="closedDates"
                    rows={2}
                    defaultValue={data.settings.closed_dates.join("\n")}
                    placeholder="2026-12-25, një datë për rresht"
                  />
                </label>
                <label className="calendar-check">
                  <input
                    type="checkbox"
                    name="agentBooking"
                    defaultChecked={data.settings.agent_booking_enabled}
                  />{" "}
                  Lejo Agjentin të marrë rezervime nga biseda
                </label>
                <button className="btn btn-primary">Ruaj orarin</button>
              </ActionForm>
            </section>
            <section>
              <h2>Google Calendar</h2>
              <p className="muted-copy">
                Takimet e konfirmuara dërgohen në Google. Orari i zënë në Google
                kontrollohet para rezervimit. Ndrysho dhe anulo takimet e
                Agjentit nga ky panel.
              </p>
              {data.google.connected ? (
                <>
                  <p>
                    {data.google.calendar_name
                      ? `Kalendari: ${data.google.calendar_name}`
                      : "Lidhja është gati. Zgjidh kalendarin."}
                  </p>
                  {!data.google.calendar_id && !!data.calendars.length && (
                    <ActionForm
                      action={selectGoogleCalendar.bind(null, slug)}
                      onSuccess={refresh}
                    >
                      <label className="calendar-field">
                        Kalendari
                        <select className="field" name="calendar" required>
                          {data.calendars.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.summary}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button className="btn btn-primary">
                        Zgjidh kalendarin
                      </button>
                    </ActionForm>
                  )}
                  <ActionForm
                    action={() => disconnectGoogleCalendar(slug)}
                    onSuccess={refresh}
                  >
                    <p className="muted-copy">
                      Shkëputja ruan ngjarjet ekzistuese në Google.
                    </p>
                    <button className="btn btn-ghost">
                      Shkëput Google Calendar
                    </button>
                  </ActionForm>
                </>
              ) : null}
              {googleConfigured ? (
                <form method="post" action="/api/calendar/google/connect">
                  <input type="hidden" name="slug" value={slug} />
                  <button className="btn btn-primary">
                    {data.google.connected
                      ? "Rilidh Google Calendar"
                      : "Lidh Google Calendar"}
                  </button>
                </form>
              ) : (
                <p className="muted-copy">
                  Lidhja me Google kërkon konfigurimin nga administratori.
                  Kalendari në panel funksionon edhe pa Google.
                </p>
              )}
            </section>
          </details>
        </>
      )}
    </div>
  );
}
