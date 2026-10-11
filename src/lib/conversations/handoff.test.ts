import { expect, it } from "vitest";
import { isStaffContactRequest } from "./handoff";

it.each(["WhatsApp", "Cili është numri juaj?", "Dua të kontaktoj stafin në WhatsApp", "Si ju kontaktoj?", "What is your phone number?"])("treats %s as contact advice", message => {
  expect(isStaffContactRequest(message)).toBe(true);
});
it.each(["Dua të flas me stafin", "Telefoni im është 0690000000; dua të flas me stafin", "Emaili im është ana@example.test", "Dua të kontaktohem në WhatsApp", "Ju lutem me telefononi", "Call me", "Sa kushton produkti?"])("does not confuse %s with a request for business contact details", message => {
  expect(isStaffContactRequest(message)).toBe(false);
});
