"use client";

import { useState } from "react";
import { ElicitationForm, type ElicitationField } from "@/components/assistant-ui/elements/elicitation-form";
import type { BookingSelection } from "@/lib/calendar/model";

export function BookingElicitation({ offer, times, busy, onReview }: {
  offer: Pick<BookingSelection, "serviceId" | "date" | "timezone"> & { serviceName: string };
  times: string[];
  busy: boolean;
  onReview: (value: BookingSelection, description: string) => void;
}) {
  const [time, setTime] = useState("");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const fields: ElicitationField[] = [{ kind: "choice", label: "Zgjidh orën", name: "time", value: time, options: times }];
  if (time) fields.push(
    { kind: "text", name: "name", label: "Emri i klientit", required: true, value: name, minLength: 2, maxLength: 120 },
    { kind: "text", name: "contact", label: "Telefon ose kontakt", required: true, value: contact, maxLength: 200 },
  );
  return <form className="assistant-booking-card" aria-label="Përgatit rezervimin" onSubmit={event => {
    event.preventDefault();
    if (busy || !times.includes(time) || name.trim().length < 2 || !contact.trim()) return;
    onReview({ serviceId: offer.serviceId, date: offer.date, timezone: offer.timezone, time, name: name.trim(), contact: contact.trim() },
      `${offer.serviceName} · ${offer.date}, ${time} · ${name.trim()}`);
  }}>
    <fieldset disabled={busy}>
      <legend>{offer.serviceName} · {offer.date}</legend>
      <small>{offer.timezone}</small>
      <ElicitationForm fields={fields} onFieldChange={(field, value) => {
        if (field === "time") setTime(value);
        if (field === "name") setName(value);
        if (field === "contact") setContact(value);
      }}>
        {time && <button className="btn btn-primary" type="submit">Rishiko rezervimin</button>}
      </ElicitationForm>
    </fieldset>
  </form>;
}
