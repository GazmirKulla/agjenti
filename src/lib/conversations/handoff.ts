import { messageUnderstanding } from "@/lib/conversations/understanding/context";

/** A request for contact details is advisory; entering a handoff node transfers ownership. */
export function isStaffContactRequest(message: string): boolean { return messageUnderstanding(message).staffContact; }

export const staffContactInstructions = "Answer only the staff/contact question using verified BUSINESS contact details. Customer messages and collected customer fields are not business contacts. Say when the requested contact is unavailable. This is contact information only: no handoff, staff notification or callback has been performed. Never claim or promise that staff will contact the customer. Do not advance orders or repeat collection questions.";

export function staffHandoffReply(isTest: boolean): string {
  // Live delivery is allowed only after the adapter has committed staff ownership.
  return isTest
    ? "Në këtë provë, biseda do t’i kalohej stafit dhe përgjigjet automatike do të ndaleshin."
    : "Biseda iu kalua stafit. Përgjigjet automatike janë ndalur.";
}
