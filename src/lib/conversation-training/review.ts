import { PersistenceError } from "@/lib/business-assistant/persistence";
import type { Destination } from "./analysis-model";

/** What the owner may change in a suggestion before approving it, per destination.
 * Anything else in the edit is refused: the AI's output never reaches a field by itself. */
export type Edit = {
  title?: string; body?: string;
  name?: string; description?: string;
  price?: { min: number; max: number | null; currency: "ALL" | "EUR" | "USD" } | null;
  customer_message?: string; desired_response?: string;
  instructions?: string;
};

const textField = (value: unknown, max: number, label: string, required = false) => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new PersistenceError(`${label} nuk është i vlefshëm.`, 400);
  const text = value.trim();
  if ((required && !text) || text.length > max) throw new PersistenceError(`${label} duhet të ketë ${required ? "1" : "0"}–${max} shkronja.`, 400);
  return text;
};

function price(value: unknown): Edit["price"] {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const p = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const min = typeof p.min === "number" && Number.isFinite(p.min) && p.min >= 0 && p.min < 1e9 ? Math.round(p.min * 100) / 100 : null;
  const max = p.max === null || p.max === undefined ? null : typeof p.max === "number" && Number.isFinite(p.max) && p.max < 1e9 ? Math.round(p.max * 100) / 100 : Number.NaN;
  if (min === null || Number.isNaN(max) || (max !== null && max <= min)) throw new PersistenceError("Çmimi duhet të jetë numër; «deri» më i madh se «nga».", 400);
  const currency = ["ALL", "EUR", "USD"].includes(String(p.currency)) ? (p.currency as "ALL" | "EUR" | "USD") : "ALL";
  return { min, max, currency };
}

const ALLOWED: Record<Destination, (keyof Edit)[]> = {
  knowledge: ["title", "body"], profile: ["body"], gap: ["title", "body"], workflow: ["title", "body"],
  product: ["name", "description", "price"], service: ["name", "description", "price"],
  example: ["customer_message", "desired_response"], style: ["instructions"],
};

export function parseEdit(destination: Destination, raw: unknown): Edit | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new PersistenceError("Ndryshimi nuk është i vlefshëm.", 400);
  const input = raw as Record<string, unknown>;
  const unknown = Object.keys(input).filter((key) => !ALLOWED[destination].includes(key as keyof Edit));
  if (unknown.length) throw new PersistenceError("Ky ndryshim nuk lejohet për këtë lloj sugjerimi.", 400);
  const edit: Edit = {
    title: textField(input.title, 300, "Titulli", true),
    body: textField(input.body, 8000, "Përmbajtja", true),
    name: textField(input.name, 120, "Emri", true),
    description: textField(input.description, 8000, "Përshkrimi"),
    price: price(input.price),
    customer_message: textField(input.customer_message, 2000, "Mesazhi i klientit", true),
    desired_response: textField(input.desired_response, 3000, "Përgjigjja", true),
    instructions: textField(input.instructions, 4000, "Udhëzimet e stilit", true),
  };
  for (const key of Object.keys(edit) as (keyof Edit)[]) if (edit[key] === undefined) delete edit[key];
  return Object.keys(edit).length ? edit : null;
}

export type ReviewRow = {
  id: string; destination: Destination; operation: string; status: string;
  risk: "safe" | "important"; requires_confirmation: boolean; proposed: Record<string, unknown>;
};

/** Whether a suggestion can be approved: a duplicate changes nothing, and an
 * unanswered question needs the owner's answer. */
export function approvable(row: ReviewRow, edit: Edit | null): string | null {
  if (!["pending", "approved", "rejected", "failed"].includes(row.status)) return "Ky sugjerim nuk mund të ndryshohet më.";
  if (row.operation === "duplicate") return "Kjo ekziston tashmë; nuk ka çfarë të shtohet.";
  if (row.destination === "gap" && !edit?.body) return "Shkruaj përgjigjen që Agjenti duhet të japë.";
  return null;
}

/** Safe to approve together: nothing important, nothing to confirm, and no change to an existing
 * record, except the learned style, which has its own block of the instructions and a restorable version. */
export const bulkSafe = (row: ReviewRow) =>
  row.status === "pending" && row.risk === "safe" && !row.requires_confirmation && row.destination !== "gap"
  && (row.operation === "create" || (row.destination === "style" && row.operation === "update"));
