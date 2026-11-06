import type { Field, Step, ToolPolicy } from "./contracts";
import { digest } from "./definition";
import type { BookingTerms } from "./booking";

/** Stable, scoped IDs derived from the editor node; no second authored workflow. */
export function bookingFields(nodeId: string) {
  const prefix = `booking_${digest(nodeId).slice(0, 16)}`;
  const key = (name: string) => `${prefix}_${name}`;
  const customer: Field[] = [
    { id: key("serviceId"), label: "Service", type: "text", min: 36, max: 36 },
    { id: key("date"), label: "Date", type: "date" },
    { id: key("time"), label: "Local time", type: "time" },
    { id: key("name"), label: "Customer name", type: "text", min: 2, max: 120 },
    { id: key("contact"), label: "Contact", type: "text", max: 200 },
  ].map(f => ({ ...f, subject: prefix, required: true }) as Field);
  const server: Field[] = [
    { id: key("serviceName"), label: "Service name", type: "text" },
    { id: key("durationMinutes"), label: "Duration in minutes", type: "number", min: 1 },
    { id: key("bufferMinutes"), label: "Buffer in minutes", type: "number", min: 0 },
    { id: key("timezone"), label: "Time zone", type: "text" },
    { id: key("confirmationMode"), label: "Confirmation mode", type: "choice", options: ["manual", "automatic"] },
  ].map(f => ({ ...f, subject: prefix, source: "server", required: true }) as Field);
  return { key, customer, server, fields: [...customer, ...server] };
}
export function expandBooking(nodeId: string, next: string, collectionOnly = false): { fields: Field[]; steps: Step[] } {
  const { key, customer, fields } = bookingFields(nodeId);
  if (collectionOnly) customer.find(f => f.id === key("contact"))!.required = false;
  const review = key("review"), effect = key("create"), failed = key("failed"), declined = key("declined");
  return { fields, steps: [
    ...customer.map((f, i): Step => ({ id: i === 0 ? nodeId : key(`collect_${i}`), kind: "collect", fieldId: f.id,
      prompt: i === 0 ? "Which service would you like to book? Resolve the service to its verified catalog identifier." : f.label,
      next: i + 1 < customer.length ? key(`collect_${i + 1}`) : review })),
    { id: review, kind: "confirm", fieldIds: fields.map(f => f.id), label: collectionOnly ? "Review the booking preferences. These details are collected only; no appointment will be created." : "Review the booking details. Manual confirmation creates a pending request, not a confirmed appointment.", yes: effect, no: declined },
    ...(collectionOnly ? [{ id: effect, kind: "message" as const, text: "Booking preferences recorded only. No slot was reserved and no booking was created.", next }] : [{ id: effect, kind: "effect" as const, tool: "booking.create", toolVersion: 1,
      inputs: Object.fromEntries(["serviceId", "date", "time", "name", "contact", "serviceName", "durationMinutes", "bufferMinutes", "timezone", "confirmationMode"].map(name => [name, key(name)])), next, failed },
    { id: failed, kind: "end" as const, label: "The booking was not created. Explain the verified failure; a new request is required to try again." }]),
    { id: declined, kind: "end", label: "The booking request was declined. No appointment was created." },
  ] };
}
export function bookingToolPolicy(allowed: boolean): ToolPolicy {
  return { key: "booking.create", version: 1, effect: "write", approval: "required", allowed,
    inputs: bookingFields("policy").fields.map(f => ({ key: f.id.slice("booking_".length + 16 + 1), type: f.type, required: true,
      ...(f.options ? { options: f.options } : {}), ...(f.min !== undefined ? { min: f.min } : {}), ...(f.max !== undefined ? { max: f.max } : {}) })) };
}
export function bookingServerValues(nodeId: string, terms: BookingTerms) {
  const { key } = bookingFields(nodeId);
  return Object.fromEntries(Object.entries(terms).map(([name, value]) => [key(name), value]));
}
