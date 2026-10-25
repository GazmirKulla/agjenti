import { describe, expect, it } from "vitest";
import { decideAiReaction } from "./ai-reaction-decision";

describe("AI reaction policy", () => {
  const base = { channel: "instagram", autoReplyEnabled: true, humanTakeover: false };
  it.each([
    [{ ...base, autoReplyEnabled: false }, "auto_reply_disabled"],
    [{ ...base, humanTakeover: true }, "human_takeover"],
    [{ ...base, manualEmoji: "👍" }, "manual_ownership"],
    [{ ...base, text: "Dua të bëj një porosi" }, "transactional_intent"],
  ])("does not react when guarded (%j)", (input, reason) => expect(decideAiReaction(input as never)).toMatchObject({ kind: "none", reason }));
  it("chooses a supported acknowledgement only for contextual gratitude", () => expect(decideAiReaction({ ...base, text: "Faleminderit shumë 😊" })).toMatchObject({ kind: "reaction", emoji: "😊" }));
  it("keeps unsupported channels inert", () => expect(decideAiReaction({ ...base, channel: "email", text: "Faleminderit" })).toMatchObject({ kind: "none", reason: "not_appropriate" }));
  it.each(['Faleminderit, por produkti është gabim', 'Super, sa kushton?', 'Faleminderit! Dua të anuloj.', 'Nuk është super', 'Perfekt, konfirmoj rezervimin', 'Faleminderit\nEmri: Drita'])('does not acknowledge a mixed substantive message: %s',text=>{
    expect(decideAiReaction({...base,text}).kind).toBe('none');
  });
  it.each(['😊','❤️','👍','Faleminderit shumë!','Thank you!'])('accepts a standalone acknowledgement: %s',text=>{
    expect(decideAiReaction({...base,text}).kind).toBe('reaction');
  });
});
