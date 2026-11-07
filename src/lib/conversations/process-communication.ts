/** Pure process output. A runtime describes the required interaction; it does
 * not write customer-facing validation errors or derive state from that prose. */
export type ProcessCommunication =
  | { kind: "configured"; text: string }
  | { kind: "collect"; field: string; label: string; format: "text" | "email" | "phone" | "number" | "photo"; guidance: string; invalid: boolean; fallback?: string }
  | { kind: "confirm"; text: string; retry: boolean }
  | { kind: "staff_waiting" };
