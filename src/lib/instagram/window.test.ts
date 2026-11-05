import { expect, it } from "vitest";
import { instagramReplyWindow } from "./window";
const now = new Date("2026-11-05T12:00:00Z");
it.each([[0,"standard"],[24*3600000-1,"standard"],[24*3600000,"human_agent"],[7*24*3600000-1,"human_agent"],[7*24*3600000,"closed"]] as const)("uses exact last-customer-message boundary at %s ms", (age, expected) => {
 expect(instagramReplyWindow(new Date(now.getTime()-age),now)).toBe(expected);
});
it.each([null,undefined,"bad-date","2026-11-06T12:00:00Z"])("fails closed for unavailable or future inbound time %s", at => {
 expect(instagramReplyWindow(at,now)).toBe("closed");
});
