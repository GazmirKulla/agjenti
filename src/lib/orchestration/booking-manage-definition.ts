import type { Field, Step, ToolPolicy } from "./contracts";
import { digest } from "./definition";

/** What the customer wants to do with a booking they already have. Read from the model's structured output, never from wording. */
export const bookingManageActions = ["status", "cancel", "reschedule"] as const;
export type BookingManageAction = (typeof bookingManageActions)[number];
/** Placeholder option until the server puts in the customer's own booking IDs for the turn. */
export const noOwnBooking = "none";

/** Stable, scoped IDs derived from the editor node, like the booking step. */
export function bookingManageFields(nodeId: string) {
  const prefix = `bookingm_${digest(nodeId).slice(0, 16)}`;
  const key = (name: string) => `${prefix}_${name}`;
  const customer: Field[] = [
    { id: key("action"), label: "What the customer wants to do with a booking they already have: status (ask about it), cancel, or reschedule (move it to another time)", type: "choice", options: [...bookingManageActions] },
    { id: key("bookingId"), label: "Which of the customer's own bookings (an ID from customerBookings)", type: "reference", options: [noOwnBooking] },
    { id: key("date"), label: "New date", type: "date" },
    { id: key("time"), label: "New local time", type: "time" },
  ].map(f => ({ ...f, subject: prefix, required: true }) as Field);
  const server: Field[] = [
    { id: key("changeable"), label: "The customer has an upcoming booking that can still be changed", type: "boolean" },
    { id: key("serviceId"), label: "Service", type: "text" },
    { id: key("serviceName"), label: "Service name", type: "text" },
    { id: key("startsAt"), label: "Current date and time", type: "text" },
    { id: key("status"), label: "Current status", type: "choice", options: ["pending", "confirmed"] },
    { id: key("bookingRevision"), label: "Booking revision", type: "number", min: 1 },
  ].map(f => ({ ...f, subject: prefix, source: "server", required: true }) as Field);
  return { key, customer, server, fields: [...customer, ...server] };
}

export function expandBookingManage(nodeId: string, next: string): { fields: Field[]; steps: Step[] } {
  const { key, fields } = bookingManageFields(nodeId);
  const booking = ["bookingId", "serviceName", "startsAt", "status", "bookingRevision"].map(key);
  const change = (name: string, action: "cancel" | "reschedule"): Step => ({ id: key(name), kind: "effect", tool: "booking.change", toolVersion: 1,
    inputs: Object.fromEntries(["action", "bookingId", "bookingRevision", ...(action === "reschedule" ? ["date", "time"] : [])].map(n => [n, key(n)])),
    next, failed: key("failed") });
  return { fields, steps: [
    { id: nodeId, kind: "collect", fieldId: key("action"), prompt: "Does the customer want to know about, cancel or move a booking they already made?", next: key("mine") },
    { id: key("mine"), kind: "effect", tool: "booking.mine", toolVersion: 1, inputs: {}, next: key("route_status"), failed: key("unverified") },
    { id: key("route_status"), kind: "condition", fieldId: key("action"), operator: "equals", value: "status", yes: key("status_done"), no: key("check") },
    { id: key("status_done"), kind: "end", label: "Tell the customer about their own bookings using only the verified result (service, date, time, status). Pending means the business has not confirmed it yet. Offer to cancel or move it." },
    { id: key("check"), kind: "resolve", fieldIds: [key("changeable")], next: key("has") },
    { id: key("has"), kind: "condition", fieldId: key("changeable"), operator: "equals", value: true, yes: key("collect_booking"), no: key("none") },
    { id: key("none"), kind: "end", label: "The customer has no upcoming booking in this conversation that can be changed. Nothing was changed. Say so; the staff can help if the booking was made another way." },
    { id: key("collect_booking"), kind: "collect", fieldId: key("bookingId"), prompt: "Which of their bookings? Use an ID from customerBookings; ask only when there is more than one.", next: key("resolve_booking") },
    { id: key("resolve_booking"), kind: "resolve", fieldIds: [key("serviceId"), ...booking.slice(1)], next: key("route_move") },
    { id: key("route_move"), kind: "condition", fieldId: key("action"), operator: "equals", value: "reschedule", yes: key("collect_date"), no: key("review_cancel") },
    { id: key("collect_date"), kind: "collect", fieldId: key("date"), prompt: "Which new date? Offer only free times from availability.", next: key("collect_time") },
    { id: key("collect_time"), kind: "collect", fieldId: key("time"), prompt: "Which new time? Offer only free times from availability.", next: key("review_move") },
    { id: key("review_cancel"), kind: "confirm", fieldIds: [key("action"), ...booking], label: "Review the cancellation of this booking. After the customer confirms, the booking is cancelled and the time is freed.", yes: key("cancel"), no: key("declined") },
    { id: key("review_move"), kind: "confirm", fieldIds: [key("action"), ...booking, key("date"), key("time")], label: "Review moving this booking to the new date and time. The new time is checked again before the change; when the business confirms bookings by hand, the moved booking waits for its confirmation again.", yes: key("move"), no: key("declined") },
    change("cancel", "cancel"),
    change("move", "reschedule"),
    { id: key("failed"), kind: "end", label: "The booking was not changed. Explain the verified failure (for example the new time is no longer free); the booking stays as it was." },
    { id: key("declined"), kind: "end", label: "The customer did not confirm. The booking stays as it was." },
    { id: key("unverified"), kind: "end", label: "The customer's bookings could not be verified. Nothing was changed; the staff can help." },
  ] };
}

export const bookingMineToolPolicy = (allowed: boolean): ToolPolicy => ({ key: "booking.mine", version: 1, effect: "read", approval: "none", allowed, inputs: [] });
export const bookingChangeToolPolicy = (allowed: boolean): ToolPolicy => ({ key: "booking.change", version: 1, effect: "write", approval: "required", allowed, inputs: [
  { key: "action", type: "choice", required: true, options: ["cancel", "reschedule"] },
  { key: "bookingId", type: "text", required: true, min: 36, max: 36 },
  { key: "bookingRevision", type: "number", required: true, min: 1 },
  { key: "date", type: "date", required: false },
  { key: "time", type: "time", required: false },
] });
