import { beforeEach, expect, it, vi } from "vitest";

const request = { cookie: undefined as string | undefined, headers: {} as Record<string, string> };
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "agjenti_native" && request.cookie ? { value: request.cookie } : undefined) }),
  headers: async () => ({ get: (name: string) => request.headers[name] ?? null }),
}));
const { isNativeEmbed } = await import("./embedded");

beforeEach(() => { request.cookie = undefined; request.headers = {}; });

it("recognises the native app by its user agent", async () => {
  request.headers = { "user-agent": "Mozilla/5.0 AgjentiNative/2.0", "sec-fetch-dest": "document" };
  expect(await isNativeEmbed()).toBe(true);
});

it("applies the preview cookie inside an iframe", async () => {
  request.cookie = "1";
  request.headers = { "sec-fetch-dest": "iframe" };
  expect(await isNativeEmbed()).toBe(true);
});

it("ignores a leftover preview cookie in a top-level browser tab", async () => {
  request.cookie = "1";
  request.headers = { "sec-fetch-dest": "document" };
  expect(await isNativeEmbed()).toBe(false);
  request.headers = {};
  expect(await isNativeEmbed()).toBe(false);
  request.headers = { "sec-fetch-dest": "webview" };
  expect(await isNativeEmbed()).toBe(false);
});
