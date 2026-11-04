/** Pure process output. A runtime describes the required interaction; it does
 * not write customer-facing validation errors or derive state from that prose. */
export type ProcessCommunication =
  | { kind: "configured"; text: string }
  | { kind: "collect"; field: string; label: string; format: "text" | "email" | "phone" | "number" | "photo"; guidance: string; invalid: boolean; fallback?: string }
  | { kind: "confirm"; text: string; retry: boolean }
  | { kind: "staff_waiting" };

const errors = {
  sq: { email: "Vendos një email të vlefshëm.", phone: "Vendos një numër telefoni të vlefshëm.", number: "Vendos një numër.", photo: "Dërgo një foto.", text: "" },
  en: { email: "Please provide a valid email address.", phone: "Please provide a valid phone number.", number: "Please provide a number.", photo: "Please send a photo.", text: "" },
};
export function renderProcessCommunication(message?: ProcessCommunication, language: "sq" | "en" = "sq"): string | undefined {
  if (!message) return;
  if (message.kind === "configured") return message.text;
  if (message.kind === "staff_waiting") return language === "en" ? "Your request is waiting for the team." : "Kërkesa juaj është në pritje të ekipit.";
  if (message.kind === "confirm") return [message.text, message.retry ? language === "en" ? "Please answer Yes or No." : "Përgjigju me Po ose Jo." : ""].filter(Boolean).join(" ");
  return message.fallback ?? [message.guidance || (language === "en" ? `Please provide: ${message.label}.` : `Plotëso: ${message.label}.`), message.invalid ? errors[language][message.format] : ""].filter(Boolean).join(" ");
}
