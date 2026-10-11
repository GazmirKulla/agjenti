import { foldText } from "@/lib/workflows/engine";

/** A request for contact details is advisory; entering a handoff node transfers ownership. */
export function isStaffContactRequest(message: string): boolean {
  const text = foldText(message);
  if (/\b(kontaktohem|me kontaktoni|me telefononi|call me|contact me)\b/.test(text)) return false;
  return text.split(/[;.!?\n]/).some(part => {
    if (/\b(telefoni im|numri im|emaili im|my phone|my number|my email)\b/.test(part)) return false;
    return /^(?:whatsapp|kontakt|contact)\s*$/.test(part.trim())
      || /\b(kontaktoj|kontaktojme|contact|kontakto\w*)\b/.test(part) && /\b(dua|ku|si|want|how)\b/.test(part)
      || /\b(whatsapp|email|e-mail|numri|numer|number|telefon\w*|phone)\b/.test(part) && /\b(staf\w*|biznes\w*|juaj|tuaj|staff|business|your)\b/.test(part);
  });
}

export const staffContactInstructions = "Answer only the staff/contact question using verified BUSINESS contact details. Customer messages and collected customer fields are not business contacts. Say when the requested contact is unavailable. This is contact information only: no handoff, staff notification or callback has been performed. Never claim or promise that staff will contact the customer. Do not advance orders or repeat collection questions.";

export function staffHandoffReply(isTest: boolean): string {
  // Live delivery is allowed only after the adapter has committed staff ownership.
  return isTest
    ? "Në këtë provë, biseda do t’i kalohej stafit dhe përgjigjet automatike do të ndaleshin."
    : "Biseda iu kalua stafit. Përgjigjet automatike janë ndalur.";
}
