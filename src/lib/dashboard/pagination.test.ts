import { expect, it } from "vitest";
import { parseListParams } from "./pagination";
it("bounds pages and fetches only the requested 25 rows", () => {
  expect(parseListParams({ page: "3" })).toMatchObject({
    page: 3,
    from: 50,
    to: 74,
  });
  for (const page of ["-3", "NaN", "0", "1.5"])
    expect(parseListParams({ page }).page).toBe(1);
  expect(parseListParams({ page: "9999999999999999999999999" }).page).toBe(
    100000,
  );
});
it("keeps Albanian searches while removing filter grammar and escaping wildcard underscores", () => {
  expect(parseListParams({ q: "  Ëndrra Çela  " }).filter).toBe("Ëndrra Çela");
  expect(parseListParams({ q: "test_%,(id.eq.other)" }).filter).toBe(
    "test\\_id.eq.other",
  );
  expect(parseListParams({ q: "a".repeat(200) }).search).toHaveLength(100);
});
