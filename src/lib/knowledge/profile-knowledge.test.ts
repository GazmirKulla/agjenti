import { expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({}) }));
import { profileEntries } from "./profile-knowledge";

it("turns the owner's answers into one knowledge topic each", () => {
  expect(profileEntries({
    businessDescription: "  Puzzle druri të personalizuara. ",
    offeringsSummary: ["Puzzle 32×22", " ", "Puzzle 30×40"],
    customerQuestions: "",
    handoffRules: "Më thirr kur klienti ankohet",
    sellsProducts: true,
  })).toEqual([
    { topic: "businessDescription", intentKey: "profile:businessDescription", title: "Përshkrimi i biznesit", body: "Puzzle druri të personalizuara." },
    { topic: "offeringsSummary", intentKey: "profile:offeringsSummary", title: "Çfarë ofron biznesi", body: "• Puzzle 32×22\n• Puzzle 30×40" },
  ]);
  expect(profileEntries(null)).toEqual([]);
});
