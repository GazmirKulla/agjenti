import { describe, expect, it } from "vitest";
import { capturedInstagramProfile } from "./captured-profile";

const connection = { id: "current-account", discovery_generation: "current-login", status: "connected" };
const capture = (id: string, generation: string, name: string) => ({
  source: "instagram", input: { connectionId: id, generation }, checkpoint: { profile: { name } },
});

describe("captured Instagram profile", () => {
  it("uses the most recent matching capture rather than another account or an earlier login", () => {
    const jobs = [capture("other-account", "current-login", "Other account"), capture("current-account", "old-login", "Old profile"),
      capture("current-account", "current-login", "Updated profile"), capture("current-account", "current-login", "Earlier profile")];
    expect(capturedInstagramProfile(connection, jobs, { ...connection, name: "Saved profile" })).toEqual({ name: "Updated profile" });
  });
  it("loads the saved onboarding profile when jobs are unavailable and exposes only public fields", () => {
    const saved = { connectionId: connection.id, generation: connection.discovery_generation, name: "Studio", biography: "First line\nSecond line",
      website: "studio.test", profile_picture_url: "https://cdn.example.test/photo.jpg", access_token: "PRIVATE", generationSecret: "PRIVATE" };
    expect(capturedInstagramProfile(connection, [], saved)).toEqual({ name: "Studio", biography: "First line\nSecond line", website: "https://studio.test/", profile_picture_url: "https://cdn.example.test/photo.jpg" });
    expect(capturedInstagramProfile({ ...connection, discovery_generation: "new-login" }, [], saved)).toBeNull();
    expect(capturedInstagramProfile({ ...connection, id: "new-account" }, [], saved)).toBeNull();
  });
  it("does not show metadata after disconnect or when connection identity is missing", () => {
    const jobs = [capture(connection.id, connection.discovery_generation, "Studio")];
    expect(capturedInstagramProfile(null, jobs, null)).toBeNull();
    expect(capturedInstagramProfile({ ...connection, status: "disconnected" }, jobs, null)).toBeNull();
    expect(capturedInstagramProfile({ ...connection, discovery_generation: "" }, jobs, null)).toBeNull();
  });
  it("skips malformed captures and removes unsafe links from the saved profile", () => {
    expect(capturedInstagramProfile(connection, [{ ...capture(connection.id, connection.discovery_generation, ""), checkpoint: { profile: [] } }],
      { connectionId: connection.id, generation: connection.discovery_generation, name: "Studio", website: "javascript:alert(1)", profile_picture_url: "https://user:password@example.test/photo" })).toEqual({ name: "Studio" });
  });
});
