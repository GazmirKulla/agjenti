import type { BookingService, CalendarSettings } from "./model";

export type BookingDraft = {
  serviceId?: string;
  date?: string;
  time?: string;
  name?: string;
  contact?: string;
  phase: "collect" | "confirm";
  nonce: string;
  expires: number;
  review?: { factsKey: string };
  preparedConfirmation?: { factsKey: string };
  /** Only profile-seeded values follow later profile corrections; recipients may differ. */
  profileSeeds?: { name?: string; contact?: string };
};

export function bookingReviewKey(businessId: string, draft: BookingDraft, versionId?: string, terms?: {
  service?: Pick<BookingService, "name" | "duration_minutes" | "buffer_minutes">;
  settings: Pick<CalendarSettings, "timezone" | "confirmation_mode">;
}) {
  return JSON.stringify([businessId, versionId ?? null, draft.nonce, draft.serviceId ?? null,
    draft.date ?? null, draft.time ?? null, draft.name ?? null, draft.contact ?? null,
    terms ? [terms.service?.name, terms.service?.duration_minutes, terms.service?.buffer_minutes,
      terms.settings.timezone, terms.settings.confirmation_mode] : null]);
}
