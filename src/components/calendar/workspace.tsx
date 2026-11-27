"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ElicitationForm, type ElicitationField } from "@/components/assistant-ui/elements/elicitation-form";
import { ActionForm } from "@/components/dashboard/action-form";
import {
  saveCalendarSettings,
  readBookingSlots,
  saveBooking,
  retryBookingSync,
  changeBooking,
  selectGoogleCalendar,
  disconnectGoogleCalendar,
} from "@/lib/calendar/actions";
import {
  dayNames,
  validDate,
  zonedParts,
  type Booking,
  type Hours,
} from "@/lib/calendar/model";
import type { CalendarData } from "@/lib/calendar/service";
import { Modal } from "@/components/modal/modal";
import type { CalendarBooking, BookingSource } from "@/lib/calendar/service";
import { bookingStatusLabels, type CalendarMode } from "./booking-calendar-modes";
import "./calendar.css";

// FullCalendar measures the browser; it renders on the client only.
const BookingCalendar = dynamic(() => import("./booking-calendar").then(m => m.BookingCalendar), {
  ssr: false,
  loading: () => <section className="booking-calendar panel booking-calendar-placeholder" role="status">Po hapet kalendari…</section>,
});
const statusLabels = bookingStatusLabels;
const syncLabels = {
  local: "Në panel",
  pending: "Në pritje të Google",
  synced: "Sinkronizuar",
  error: "Google kërkon riprovim",
};
function BookingFields({
  slug,
  data,
  date,
  booking,
  initialService,
  initialTime,
}: {
  slug: string;
  data: CalendarData;
  date: string;
  booking?: Booking;
  initialService?: string;
  /** The time clicked in the calendar; kept when it is one of the free times. */
  initialTime?: string;
}) {
  const initial = booking
    ? zonedParts(booking.starts_at, data.settings.timezone)
    : { date, time: initialTime ?? "" };
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
  const [name, setName] = useState(booking?.customer_name ?? "");
  const [contact, setContact] = useState(booking?.customer_contact ?? "");
  const [time, setTime] = useState(initial.time);
  const [manual, setManual] = useState(Boolean(booking));
  const [status, setStatus] = useState<Booking["status"]>(booking?.status ?? "confirmed");
  const [attempt, retry] = useState(0);
  const selection = JSON.stringify([slug, serviceId, selectedDate, booking?.id, attempt]);
  const [lookup, setLookup] = useState<{ selection: string; times?: string[] } | null>(null);
  const bookingId = booking?.id;
  const timezone = data.settings.timezone;
  useEffect(() => {
    if (!serviceId || !validDate(selectedDate) || status === "cancelled") return;
    let active = true;
    readBookingSlots(slug, serviceId, selectedDate, bookingId).then(starts => {
      if (active) setLookup({ selection, times: starts.map(start => zonedParts(start, timezone).time) });
    }).catch(() => { if (active) setLookup({ selection }); });
    return () => { active = false; };
  }, [slug, serviceId, selectedDate, bookingId, timezone, selection, status]);
  const current = lookup?.selection === selection ? lookup : null;
  const times = current?.times ?? [];
  const selectedTime = manual || status === "cancelled" || times.includes(time) ? time : "";
  const contactFields: ElicitationField[] = [
    { kind: "text", name: "name", label: "Emri i klientit", value: name, required: true, minLength: 2, maxLength: 120, autoComplete: "name" },
    { kind: "text", name: "contact", label: "Telefon ose kontakt (opsional)", value: contact, maxLength: 200 },
  ];
  const fields: ElicitationField[] = [
    ...(!manual && times.length ? [{ kind: "choice" as const, name: "time", label: "Oraret e lira", value: selectedTime, options: times }] : []),
    ...(selectedTime || booking ? contactFields : []),
  ];
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
          onChange={(e) => { setService(e.target.value); setTime(""); }}
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
        Data
        <input
          className="field"
          type="date"
          name="date"
          required
          value={selectedDate}
          onChange={(e) => { setDate(e.target.value); setTime(""); }}
        />
      </label>
      <div className="calendar-wide">
        {status !== "cancelled" && validDate(selectedDate) && <div role="status" className="booking-lookup">
          {!current ? "Po kontrollohen oraret…" : !current.times ? "Oraret nuk u verifikuan." :
            !times.length ? "Nuk ka orare të lira për këtë ditë." : null}
          {current && !current.times && <button type="button" className="btn btn-ghost" onClick={() => retry(n => n + 1)}>Riprovo</button>}
        </div>}
        {manual && <label>Ora <input className="field" type="time" name="time" required
          value={time} onChange={e => setTime(e.target.value)} /></label>}
        {status !== "cancelled" && <button type="button" className="btn btn-ghost booking-time-mode"
          onClick={() => { setManual(!manual); setTime(""); }}>
          {manual ? "Zgjidh nga oraret e lira" : "Vendos orën manualisht"}
        </button>}
        <ElicitationForm fields={fields} onFieldChange={(field, value) => {
          if (field === "time") setTime(value);
          if (field === "name") setName(value);
          if (field === "contact") setContact(value);
        }} />
      </div>
      <label>
        Statusi
        <select
          className="field"
          name="status"
          value={status}
          onChange={e => {
            const next = e.target.value as Booking["status"];
            setStatus(next);
            if (next === "cancelled" && booking) { setManual(true); setDate(initial.date); setTime(initial.time); setService(booking.service_id); }
          }}
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
      <button className="btn btn-primary" type="submit" disabled={!selectedTime || !name.trim() || (!booking && !requestKey)}>
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
const sourceLabels: Record<BookingSource, string> = { conversation: "Nga biseda", assistant: "Nga Asistenti", panel: "Nga paneli" };
function when(booking: Booking, timezone: string) {
  const start = zonedParts(booking.starts_at, timezone), end = zonedParts(booking.ends_at, timezone);
  const day = new Date(`${start.date}T12:00:00Z`);
  return { day: `${dayNames[day.getUTCDay()]}, ${start.date.slice(8)}.${start.date.slice(5, 7)}.${start.date.slice(0, 4)}`, time: `${start.time} – ${end.time}` };
}

/** Konfirmo / Refuzo for a pending booking. Refusing asks once more: the customer may be told. */
function DecisionButtons({ slug, booking, onDone }: { slug: string; booking: CalendarBooking; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [confirmRefusal, setConfirmRefusal] = useState(false);
  const [error, setError] = useState("");
  async function decide(status: "confirmed" | "cancelled") {
    setBusy(true);
    setError("");
    const result = await changeBooking(slug, { id: booking.id, revision: booking.revision, status });
    setBusy(false);
    if (result.error) setError(result.error);
    else onDone(result.success ?? "U ruajt.");
  }
  return (
    <div className="booking-decision">
      {confirmRefusal ? (
        <>
          <span className="muted-copy">Ta refuzojmë? Klienti njoftohet nëse i ka shkruar biznesit në 24 orët e fundit.</span>
          <button type="button" className="btn btn-small booking-refuse" disabled={busy} onClick={() => decide("cancelled")}>Po, refuzo</button>
          <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setConfirmRefusal(false)}>Jo</button>
        </>
      ) : (
        <>
          <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => decide("confirmed")}>Konfirmo</button>
          <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setConfirmRefusal(true)}>Refuzo</button>
        </>
      )}
      {error && <p className="booking-decision-error" role="alert">{error}</p>}
    </div>
  );
}

function PendingQueue({ slug, pending, timezone, onOpen, onDone }: {
  slug: string; pending: CalendarBooking[]; timezone: string; onOpen: (b: CalendarBooking) => void; onDone: (message: string) => void;
}) {
  return (
    <section className="panel section-pad booking-queue" aria-labelledby="booking-queue-title">
      <div className="booking-queue-heading">
        <h2 id="booking-queue-title">Kërkon veprim</h2>
        <span className="booking-count">{pending.length}</span>
      </div>
      <p className="muted-copy">Rezervime që presin vendimin tënd. Orari mbahet i zënë derisa t’i konfirmosh ose refuzosh.</p>
      <ul>
        {pending.map(b => {
          const at = when(b, timezone);
          return (
            <li key={`${b.id}-${b.revision}`} className="booking-queue-item">
              <button type="button" className="booking-queue-open" onClick={() => onOpen(b)}>
                <span className="booking-queue-time"><strong>{at.time}</strong><small>{at.day}</small></span>
                <span className="booking-queue-who"><strong>{b.customer_name}</strong><small>{b.service_name} · {sourceLabels[b.source]}</small></span>
              </button>
              <DecisionButtons slug={slug} booking={b} onDone={onDone} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function BookingDetails({ slug, data, booking, onSaved }: {
  slug: string; data: CalendarData; booking: CalendarBooking; onSaved: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const at = when(booking, data.settings.timezone);
  return (
    <div className="booking-details">
      <dl>
        <div><dt>Data</dt><dd>{at.day}</dd></div>
        <div><dt>Ora</dt><dd>{at.time}</dd></div>
        <div><dt>Shërbimi</dt><dd>{booking.service_name}</dd></div>
        <div><dt>Klienti</dt><dd>{booking.customer_name}{booking.customer_contact ? ` · ${booking.customer_contact}` : ""}</dd></div>
        <div><dt>Statusi</dt><dd><span className={`calendar-badge is-${booking.status}`}>{statusLabels[booking.status]}</span></dd></div>
        <div><dt>Burimi</dt><dd>{sourceLabels[booking.source]}{booking.conversation_id && <> · <Link className="inline-link" href={`/b/${slug}/inbox/${booking.conversation_id}`}>Hap bisedën →</Link></>}</dd></div>
        <div><dt>Google</dt><dd>{syncLabels[booking.sync_status]}</dd></div>
        {booking.notes && <div><dt>Shënime</dt><dd>{booking.notes}</dd></div>}
      </dl>
      {booking.status === "pending" && <DecisionButtons slug={slug} booking={booking} onDone={onSaved} />}
      {["error", "pending"].includes(booking.sync_status) && booking.status !== "cancelled" && (
        <ActionForm action={retryBookingSync.bind(null, slug)} onSuccess={() => onSaved("Sinkronizimi përfundoi.")}>
          <input type="hidden" name="id" value={booking.id} />
          <button className="btn btn-ghost btn-small">Riprovo Google</button>
        </ActionForm>
      )}
      {booking.status !== "cancelled" && (
        editing ? (
          <section className="booking-edit">
            <h3>Ndrysho ose anulo</h3>
            <ActionForm action={saveBooking.bind(null, slug)} onSuccess={() => onSaved("Rezervimi u ruajt.")}>
              <BookingFields slug={slug} data={data} date={zonedParts(booking.starts_at, data.settings.timezone).date} booking={booking} />
            </ActionForm>
          </section>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={() => setEditing(true)}>Ndrysho / Anulo</button>
        )
      )}
    </div>
  );
}

export type BookingsTab = "bookings" | "settings";
const bookingsTabs: [BookingsTab, string][] = [["bookings", "Takimet"], ["settings", "Orari dhe Google Calendar"]];
type Dialog = { kind: "new"; date: string; time?: string } | { kind: "booking"; booking: CalendarBooking } | null;
export function CalendarWorkspace({
  data,
  pending,
  slug,
  date,
  mode,
  tab: initialTab,
  googleConfigured,
  googleNotice,
  initialService,
}: {
  data: CalendarData;
  /** Null when the pending list could not be loaded. */
  pending: CalendarBooking[] | null;
  slug: string;
  date: string;
  mode?: CalendarMode;
  /** Which part of the page opens: the bookings, or the hours and Google Calendar. */
  tab: BookingsTab;
  googleConfigured: boolean;
  googleNotice?: string;
  initialService?: string;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(initialService ? { kind: "new", date } : null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<BookingsTab>(initialTab);
  const openTab = (next: BookingsTab) => {
    setTab(next);
    // The URL keeps the open tab, so a refresh or a shared link opens the same place.
    const url = new URL(window.location.href);
    if (next === "settings") url.searchParams.set("tab", "settings"); else url.searchParams.delete("tab");
    window.history.replaceState(null, "", url);
  };
  const bookable = data.services.some((s) => s.is_active && s.booking_enabled !== false);
  const refresh = () => {
    setRefreshKey(k => k + 1);
    router.refresh();
  };
  const done = (text: string) => {
    setDialog(null);
    setMessage(text);
    refresh();
  };
  return (
    <div className="calendar-workspace">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">TAKIMET E BIZNESIT</p>
          <h1>Rezervimet</h1>
          <p className="page-description">
            Kërkesat që presin vendim dhe të gjitha takimet. Në kalendar kliko një orë të lirë për rezervim të ri ose tërhiq një takim për ta zhvendosur.
          </p>
        </div>
        <button className="btn btn-primary" disabled={!bookable} onClick={() => setDialog({ kind: "new", date })}>
          + Shto rezervim
        </button>
      </div>
      {!data.available ? (
        <section className="panel section-pad" role="status">
          Kalendari kërkon përditësimin e databazës. Administratori duhet të
          aplikojë migrimin e kalendarit.
        </section>
      ) : (
        <>
          {googleNotice && <p className="calendar-notice" role="status">{googleNotice}</p>}
          {data.googleError && <p className="calendar-notice" role="alert">{data.googleError}</p>}
          {message && (
            <p className="calendar-notice is-success" role="status">
              {message}
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setMessage("")}>Mbyll</button>
            </p>
          )}
          {!bookable && (
            <p className="calendar-notice">
              Për të filluar, aktivizo rezervimin me orar te{" "}
              <Link href={`/b/${slug}/services`}>Shërbimet</Link>.
            </p>
          )}
          <div className="bookings-tabs" role="tablist" aria-label="Seksionet e rezervimeve">
            {bookingsTabs.map(([id, text]) => (
              <button key={id} type="button" role="tab" id={`bookings-tab-${id}`} aria-selected={tab === id} aria-controls={`bookings-panel-${id}`}
                className={tab === id ? "is-active" : ""} onClick={() => openTab(id)}>{text}</button>
            ))}
          </div>
          {tab === "bookings" && <div className="bookings-panel" role="tabpanel" id="bookings-panel-bookings" aria-labelledby="bookings-tab-bookings">
          {pending === null ? (
            <p className="calendar-notice" role="alert">Rezervimet në pritje nuk u ngarkuan. Rifresko faqen.</p>
          ) : !!pending.length && (
            <PendingQueue slug={slug} pending={pending} timezone={data.settings.timezone}
              onOpen={b => setDialog({ kind: "booking", booking: b })} onDone={done} />
          )}
          <BookingCalendar
            slug={slug}
            settings={data.settings}
            date={date}
            mode={mode ?? "list"}
            refreshKey={refreshKey}
            onOpen={booking => setDialog({ kind: "booking", booking })}
            onCreate={at => bookable && setDialog({ kind: "new", ...at })}
            onChanged={() => router.refresh()}
          />
          </div>}
          {dialog?.kind === "new" && (
            <Modal title="Rezervim i ri" subtitle={data.settings.timezone} onClose={() => setDialog(null)}>
              <ActionForm action={saveBooking.bind(null, slug)} onSuccess={() => done("Rezervimi u shtua.")}>
                <BookingFields slug={slug} data={data} date={dialog.date} initialTime={dialog.time} initialService={initialService} />
              </ActionForm>
            </Modal>
          )}
          {dialog?.kind === "booking" && (
            <Modal title={dialog.booking.customer_name} subtitle={dialog.booking.service_name} onClose={() => setDialog(null)}>
              <BookingDetails key={`${dialog.booking.id}-${dialog.booking.revision}`} slug={slug} data={data} booking={dialog.booking} onSaved={done} />
            </Modal>
          )}
          {tab === "settings" && <div className="panel section-pad calendar-settings" role="tabpanel" id="bookings-panel-settings" aria-labelledby="bookings-tab-settings">
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
                <input type="hidden" name="expectedSettings" value={JSON.stringify(data.settings)} />
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
                <p className="muted-copy">
                  {data.settings.agent_booking_enabled ? "Agjenti rezervon vetë sipas këtij orari." : "Agjenti nuk rezervon vetë."}{" "}
                  <Link className="inline-link" href={`/b/${slug}/agents/process`}>Ndrysho te Çfarë bën Agjenti →</Link>
                </p>
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
          </div>}
        </>
      )}
    </div>
  );
}
