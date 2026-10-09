import {
  defaultSettings,
  parseSettings,
  type BookingService,
  type Hours,
} from "@/lib/calendar/model";
export type BusinessService = BookingService & {
  description: string;
  category: string;
  price_amount: number | null;
  currency: "EUR" | "ALL" | "USD";
  price_mode: "fixed" | "from" | "request";
  booking_enabled: boolean;
  hours: Hours[] | null;
  updated_at: string;
};
export const serviceColumns =
  "id,name,description,category,price_amount,currency,price_mode,booking_enabled,hours,duration_minutes,buffer_minutes,is_active,updated_at";
export function parseService(form: FormData) {
  const name = String(form.get("name") ?? "").trim(),
    description = String(form.get("description") ?? "").trim(),
    category = String(form.get("category") ?? "").trim();
  const currency = String(form.get("currency") ?? "EUR"),
    price_mode = String(form.get("priceMode") ?? "request");
  const rawPrice = String(form.get("price") ?? "").trim(),
    price_amount = price_mode === "request" ? null : Number(rawPrice);
  const booking_enabled = form.get("bookingEnabled") === "on";
  const duration_minutes = booking_enabled ? Number(form.get("duration")) : 30,
    buffer_minutes = booking_enabled ? Number(form.get("buffer")) : 0;
  if (
    name.length < 2 ||
    name.length > 120 ||
    description.length > 8000 ||
    category.length > 120
  )
    throw new Error(
      "Vendos emrin (2–120 karaktere) dhe një përshkrim deri në 8000 karaktere.",
    );
  if (
    !["EUR", "ALL", "USD"].includes(currency) ||
    !["fixed", "from", "request"].includes(price_mode) ||
    (price_mode !== "request" &&
      (!rawPrice ||
        !Number.isFinite(price_amount) ||
        price_amount! < 0 ||
        price_amount! > 9999999999.99 ||
        !/^\d+(\.\d{1,2})?$/.test(rawPrice)))
  )
    throw new Error("Vendos një çmim të vlefshëm ose zgjidh “Sipas kërkesës”.");
  if (
    !Number.isInteger(duration_minutes) ||
    duration_minutes < 5 ||
    duration_minutes > 480 ||
    !Number.isInteger(buffer_minutes) ||
    buffer_minutes < 0 ||
    buffer_minutes > 120
  )
    throw new Error(
      "Kohëzgjatja duhet të jetë 5–480 min dhe pushimi 0–120 min.",
    );
  let hours: Hours[] | null = null;
  if (booking_enabled && form.get("customHours") === "on") {
    try {
      hours = parseSettings({
        ...defaultSettings,
        hours: JSON.parse(String(form.get("hours") ?? "[]")),
      }).hours;
    } catch {
      throw new Error(
        "Kontrollo orarin e shërbimit. Intervalet nuk duhet të mbivendosen.",
      );
    }
    if (!hours.length)
      throw new Error("Shto të paktën një interval për orarin e shërbimit.");
  }
  return {
    name,
    description,
    category,
    price_amount,
    currency: currency as BusinessService["currency"],
    price_mode: price_mode as BusinessService["price_mode"],
    booking_enabled,
    duration_minutes,
    buffer_minutes,
    hours,
    is_active: form.get("active") === "on",
  };
}
export function servicePrice(
  service: Pick<BusinessService, "price_mode" | "price_amount" | "currency">,
) {
  if (service.price_mode === "request" || service.price_amount == null)
    return "Sipas kërkesës";
  return `${service.price_mode === "from" ? "Nga " : ""}${new Intl.NumberFormat("sq-AL", { style: "currency", currency: service.currency }).format(service.price_amount)}`;
}
