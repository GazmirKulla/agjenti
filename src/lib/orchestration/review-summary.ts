import type { Fact, Field, Value } from "./contracts";
import { orderQuantityField } from "./order-context";

/**
 * The lines a customer reviews before approving an order or booking. Values come from the saved facts,
 * exactly as the server will submit them; what is left out is only what the customer does not decide
 * or cannot read: catalog identifiers, the currency on its own line (it goes with the price), a
 * repeated copy of the chosen options, and the scheduling internals of a booking. Labels are not set
 * here: the reply model writes them in the conversation's language, keyed by the line id.
 */
export type ReviewLine = { id: string; field: string; value: string };

// Built-in order and booking fields are scoped as `${subject}_${name}` (orderFields, bookingFields,
// bookingManageFields for a change to an existing booking).
const builtIn = (field: Field, domain: "order" | "booking" | "bookingm") =>
  field.subject.startsWith(`${domain}_`) && field.id.startsWith(`${field.subject}_`) ? field.id.slice(field.subject.length + 1) : null;
const hidden = {
  order: new Set(["productId", "productTypeId", "currency", "options", "quantity"]),
  booking: new Set(["serviceId", "bufferMinutes", "timezone", "confirmationMode"]),
  // The change itself is said by the review's own wording; the customer reviews the booking and the new time.
  bookingm: new Set(["action", "bookingId", "bookingRevision", "serviceId", "status", "changeable"]),
};

const amount = (n: number) => String(Math.round(n * 100) / 100);
const text = (value: Value) => Array.isArray(value) ? value.join(", ") : typeof value === "number" ? amount(value) : String(value);

export function reviewLines(fieldIds: string[], fields: Field[], facts: Record<string, Fact | undefined>): ReviewLine[] {
  const byId = new Map(fields.map(f => [f.id, f]));
  const sibling = (field: Field, name: string) => facts[`${field.subject}_${name}`]?.value;
  // What is ordered or booked first, then its quantity and price, then the customer's own details.
  const rank = (line: ReviewLine) => {
    const field = byId.get(line.id)!, name = builtIn(field, "order"), service = builtIn(field, "booking") ?? builtIn(field, "bookingm");
    return service === "serviceName" || service === "durationMinutes" ? -1 : field.subject === "customer" ? 3 : name === "unitAmount" ? 2 : name === "quantity" ? 1 : 0;
  };
  return lines().map((line, i) => ({ line, i })).sort((a, b) => rank(a.line) - rank(b.line) || a.i - b.i).map(({ line }) => line);
  function lines(): ReviewLine[] { return fieldIds.flatMap(id => {
    const field = byId.get(id), fact = facts[id];
    if (!field || !fact || fact.value === "" || (Array.isArray(fact.value) && !fact.value.length)) return [];
    // The ordered amount is reviewed once, as the order quantity below.
    if (id === orderQuantityField) return [];
    const order = builtIn(field, "order"), booking = builtIn(field, "booking"), change = builtIn(field, "bookingm");
    if (order && hidden.order.has(order) || booking && hidden.booking.has(booking) || change && hidden.bookingm.has(change)) {
      // Quantity is shown only when it is not the single item every order has.
      const quantity = order === "quantity" && typeof fact.value === "number" && fact.value !== 1;
      return quantity ? [{ id, field: field.label, value: amount(fact.value as number) }] : [];
    }
    if (order === "unitAmount" && typeof fact.value === "number") {
      const currency = sibling(field, "currency"), quantity = sibling(field, "quantity");
      if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) return [];
      return [{ id, field: "Total price", value: `${amount(fact.value * (typeof quantity === "number" ? quantity : 1))} ${currency}` }];
    }
    if (booking === "durationMinutes" && typeof fact.value === "number") return [{ id, field: field.label, value: `${fact.value} min` }];
    // Yes/no answers and a received photo read the same in every language.
    if (field.type === "photo") return [{ id, field: field.label, value: "📷 ✓" }];
    if (typeof fact.value === "boolean") return [{ id, field: field.label, value: fact.value ? "✓" : "✗" }];
    return [{ id, field: field.label, value: text(fact.value) }];
  }); }
}
