import { expect, it } from "vitest";
import { cleanKeywords, isWaiting, leadName, leadSettings, leadView } from "./model";

it("turns every rule on unless the owner turned it off", () => {
  expect(leadSettings(null)).toMatchObject({ enabled: true, price: true, availability: true, contact: true, followUpHours: 4 });
  expect(leadSettings({ price: false, followUpHours: 24, keywords: ["katalog"] })).toMatchObject({ price: false, followUpHours: 24, keywords: ["katalog"] });
  expect(leadSettings({ followUpHours: 7 }).followUpHours).toBe(4);
});

it("cleans the owner's keywords", () => {
  expect(cleanKeywords(" porosi  me shumicë, katalog,Katalog, a ,")).toEqual(["porosi me shumicë", "katalog"]);
  expect(cleanKeywords(Array.from({ length: 30 }, (_, i) => `fjala${i}`).join(","))).toHaveLength(20);
});

it("counts only unanswered new leads older than the follow-up time as waiting", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  expect(isWaiting({ status: "new", last_interest_at: "2026-11-10T07:00:00Z" }, 4, now)).toBe(true);
  expect(isWaiting({ status: "new", last_interest_at: "2026-11-10T10:00:00Z" }, 4, now)).toBe(false);
  expect(isWaiting({ status: "contacted", last_interest_at: "2026-11-09T07:00:00Z" }, 4, now)).toBe(false);
});

it("names a lead and falls back to the open view", () => {
  expect(leadName({ customer: { id: "c", display_name: null, username: "ana", phone: null } })).toBe("@ana");
  expect(leadName({ customer: null })).toBe("Klient pa emër");
  expect(leadView("lost")).toBe("lost");
  expect(leadView("other")).toBe("open");
});
