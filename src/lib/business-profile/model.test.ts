import { describe, expect, it } from "vitest";
import { agentProfileContext, hoursText, missingFields, parseProfile, profileChanges, readProfile } from "./model";

describe("business public profile", () => {
  it("keeps only stated values, normalizes links and orders the week", () => {
    const profile = parseProfile({ version: 1, identity: { description: "  Lodra druri  ", activity: "" }, contacts: { website: "zana.al", phone: "+355 69 123 4567", socials: [] },
      hours: { weekly: [{ day: 3, open: "09:00", close: "17:00" }, { day: 1, open: "14:00", close: "18:00" }, { day: 1, open: "09:00", close: "12:00" }], closed_days: [0] } });
    expect(profile).toEqual({ version: 1, identity: { description: "Lodra druri" }, contacts: { phone: "+355 69 123 4567", website: "https://zana.al/" },
      hours: { weekly: [{ day: 1, open: "09:00", close: "12:00" }, { day: 1, open: "14:00", close: "18:00" }, { day: 3, open: "09:00", close: "17:00" }], closed_days: [0] } });
  });
  it.each([
    [{ contacts: { email: "jo-email" } }, "Email-i"],
    [{ contacts: { website: "javascript:alert(1)" } }, "Website-i"],
    [{ hours: { weekly: [{ day: 8, open: "09:00", close: "17:00" }] } }, "interval"],
    [{ hours: { weekly: [{ day: 1, open: "9", close: "17:00" }] } }, "interval"],
    [{ hours: { weekly: [{ day: 1, open: "09:00", close: "17:00" }], closed_days: [1] } }, "njëkohësisht"],
    [{ location: { lat: 41.3 } }, "bashkë"],
    [{ contacts: { socials: [{ network: "myspace", url: "x.com" }] } }, "Rrjeti"],
  ])("refuses an invalid profile %j", (raw, message) => expect(() => parseProfile({ version: 1, ...raw })).toThrow(message));

  it("offers what is missing as actions and never as closed; an old or broken shape reads as empty", () => {
    expect(missingFields({ version: 1, contacts: { phone: "+355 69 000 0000" } }).map(field => field.action)).toEqual(
      ["Shto përshkrimin", "Shto veprimtarinë", "Shto email-in", "Shto website-in", "Shto adresën", "Shto orarin"]);
    expect(readProfile({ version: 1, contacts: { email: 42 } })).toEqual({ version: 1 });
    expect(hoursText({ weekly: [{ day: 1, open: "09:00", close: "17:00" }], closed_days: [0] })).toBe("E diel: pushim · E hënë 09:00–17:00");
  });

  it("gives the agent only the stated sections, with what an unstated day means", () => {
    expect(agentProfileContext({ version: 1 }, "Zana", "Europe/Tirane")).toBeUndefined();
    const context = agentProfileContext({ version: 1, hours: { weekly: [{ day: 1, open: "09:00", close: "17:00" }] } }, "Zana", "Europe/Tirane")!;
    expect(Object.keys(context)).toEqual(["name", "timezone", "hours", "hoursMeaning"]);
    expect(context.hoursMeaning).toContain("unknown");
    expect(context.hoursMeaning).toContain("never that it is closed");
  });

  it("states each change before → after for the confirmation and the history", () => {
    expect(profileChanges({ version: 1, location: { address: "Rruga A" } }, { version: 1, location: { address: "Rruga B" }, hours: { closed_days: [0] } })).toEqual([
      { label: "Profili · Adresa", before: "Rruga A", after: "Rruga B" },
      { label: "Profili · Orari", before: "—", after: "E diel: pushim" },
    ]);
  });
});
