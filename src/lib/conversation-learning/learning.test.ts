import { describe, expect, it } from "vitest";
import { normalizeLearningSettings, defaultLearningSettings } from "./settings";
import { cleanLines, mergeTranscripts, redact, transcriptText, validSuggestions, type Transcript } from "./transcripts";
import { instagramHistory } from "./instagram-history";

describe("learning settings", () => {
  it("uses the defaults for missing or broken values and keeps limits", () => {
    expect(normalizeLearningSettings(null)).toEqual(defaultLearningSettings);
    const s = normalizeLearningSettings({ min_conversations: "0", messages_per_conversation: 50, max_conversations: "x", lookback_days: 30.4, enabled: false });
    expect(s).toMatchObject({ min_conversations: 1, messages_per_conversation: 20, max_conversations: 50, lookback_days: 30, enabled: false, instagram_history: true });
  });
});

describe("redact", () => {
  it("removes phones, emails and token links but keeps prices", () => {
    expect(redact("Më shkruaj te ana@test.al ose 069 123 4567")).toBe("Më shkruaj te [email] ose [telefon]");
    expect(redact("+355 69 123 45 67")).toBe("[telefon]");
    expect(redact("Kushton 1500 - 2000 lekë")).toBe("Kushton 1500 - 2000 lekë");
    expect(redact("https://x.al/p?token=abc")).toBe("[lidhje]");
  });
});

const t = (key: string, lastAt: string, lines: Transcript["lines"] = [{ speaker: "klienti", text: "Sa kushton?", at: lastAt }]): Transcript => ({ key, channel: "instagram", lines, lastAt });

describe("transcripts", () => {
  it("keeps the newest lines in order and trims them", () => {
    const lines = cleanLines([
      { speaker: "klienti", text: " c ", at: "2026-01-03" },
      { speaker: "klienti", text: "a", at: "2026-01-01" },
      { speaker: "biznesi", text: "", at: "2026-01-04" },
      { speaker: "biznesi", text: "b", at: "2026-01-02" },
    ], 2);
    expect(lines.map((l) => l.text)).toEqual(["b", "c"]);
  });
  it("prefers the stored copy and caps the newest conversations", () => {
    const merged = mergeTranscripts([t("instagram:1", "2026-01-02")], [t("instagram:1", "2026-01-05"), t("instagram:2", "2026-01-04"), t("instagram:3", "2026-01-01")], 2);
    expect(merged.map((m) => [m.key, m.lastAt])).toEqual([["instagram:2", "2026-01-04"], ["instagram:1", "2026-01-02"]]);
  });
  it("bounds the text sent to the AI", () => {
    const text = transcriptText([t("a", "1"), t("b", "2")], 60);
    expect(text).toContain("Biseda 1");
    expect(text).not.toContain("Biseda 2");
  });
});

describe("validSuggestions", () => {
  it("drops broken, duplicate and already known suggestions and checks conflicts", () => {
    const out = validSuggestions({ suggestions: [
      { kind: "faq", title: "A dërgoni në Durrës?", body: "Po, 300 lekë.", evidence: ["a dergoni ne durres", 5], count: 4, existing_title: "" },
      { kind: "faq", title: "a dërgoni në durrës?", body: "Dublikatë", evidence: [], count: 9, existing_title: "" },
      { kind: "fact", title: "Orari", body: "9–18", evidence: [], count: 2, existing_title: "" },
      { kind: "gap", title: "A keni XL?", body: "", evidence: [], count: 7, existing_title: "" },
      { kind: "conflict", title: "Dërgesa", body: "400 lekë", evidence: [], count: 3, existing_title: "dërgesa" },
      { kind: "conflict", title: "Kthimi", body: "7 ditë", evidence: [], count: 3, existing_title: "Nuk ekziston" },
      { kind: "other", title: "X", body: "Y" },
    ] }, ["Orari", "Dërgesa"]);
    expect(out.map((s) => [s.kind, s.title])).toEqual([["gap", "A keni XL?"], ["faq", "A dërgoni në Durrës?"], ["conflict", "Dërgesa"]]);
    expect(out.find((s) => s.kind === "conflict")?.existingTitle).toBe("Dërgesa");
    expect(out.find((s) => s.kind === "faq")?.evidence).toEqual(["a dergoni ne durres"]);
  });
});

describe("instagramHistory", () => {
  it("reads recent conversations, names speakers and stops at the period", async () => {
    const calls: string[] = [];
    const graph = async (path: string, params: Record<string, string>) => {
      calls.push(`${path} ${params.fields}`);
      if (path === "me/conversations") return { data: [
        { id: "c1", updated_time: "2026-11-10T10:00:00+0000", participants: { data: [{ id: "biz" }, { id: "cust1" }] } },
        { id: "c2", updated_time: "2026-01-01T10:00:00+0000", participants: { data: [{ id: "biz" }, { id: "cust2" }] } },
      ] };
      return { messages: { data: [
        { id: "m2", created_time: "2026-11-10T10:00:00+0000", from: { id: "biz" }, message: "Po, 300 lekë" },
        { id: "m3", created_time: "2026-11-10T10:01:00+0000", from: { id: "biz" }, message: "Nga agjenti" },
        { id: "m1", created_time: "2026-11-10T09:00:00+0000", from: { id: "cust1" }, message: "Dërgoni në Durrës?" },
      ] } };
    };
    const out = await instagramHistory({ graph, accountId: "biz", since: new Date("2026-10-01"), maxConversations: 10, perConversation: 20, agentMessageIds: new Set(["m3"]) });
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe("instagram:cust1");
    expect(out[0].lines.map((l) => l.speaker)).toEqual(["biznesi", "agjenti", "klienti"]);
    expect(calls).toContain("c1 messages.limit(20){id,created_time,from,message}");
  });
});
