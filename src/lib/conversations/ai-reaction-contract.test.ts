import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { decideAiReaction } from "./ai-reaction-decision";

describe("server-only AI reaction contract", () => {
  it("reuses the operation ledger with a server actor, not a second identity model", () => {
    const migration = readFileSync("supabase/migrations/20261024013000_ai_reaction_server_actor.sql", "utf8");
    expect(migration).toContain("actor_kind='ai' and user_id is null");
    expect(migration).not.toContain("create table");
    expect(migration).toContain("ai_reactions_enabled boolean not null default false");
  });
  it("keeps the decision inert when manual ownership exists", async () => {
    expect((await decideAiReaction({ channel: "instagram", text: "Faleminderit", autoReplyEnabled: true, humanTakeover: false, manualEmoji: "👍" })).kind).toBe("none");
  });
});
