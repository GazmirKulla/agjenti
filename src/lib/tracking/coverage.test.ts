import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { actions } from "@/lib/business-assistant/model";
import { operationCatalog } from "@/lib/actions/operations/catalog";
import { assistantCapability } from "./assistant-events";
import { capabilities, customerCapabilities, processToolCapability } from "./capabilities";

/** Source scanning here only finds code declarations (tool keys, emitted literals); it never reads a conversation. */
const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
});
const source = files("src");

describe("every capability the agents have is tracked at its entry and its exits", () => {
  it("maps every process tool the code declares to a customer capability", () => {
    const tools = new Set(source.flatMap(path => [...readFileSync(path, "utf8").matchAll(/key: "([a-z]+\.[a-z]+)", version: \d+/g)].map(m => m[1])));
    expect(tools.size).toBeGreaterThan(0);
    const untracked = [...tools].filter(tool => !processToolCapability[tool]);
    expect(untracked, `Process tools without a capability: add them to processToolCapability: ${untracked.join(", ")}`).toEqual([]);
  });

  it("gives every Assistant action and operation its own capability", () => {
    for (const action of actions) expect(assistantCapability(action)).toBe(`assistant.${action}`);
    for (const key of Object.keys(operationCatalog)) expect(assistantCapability("operation", key)).toBe(`assistant.${key}`);
  });

  it("has a source that emits each declared capability, its entry and every exit", () => {
    const missing: string[] = [];
    for (const [id, spec] of Object.entries(capabilities)) {
      if (!spec.emittedBy.length) { missing.push(`${id}: no source`); continue; }
      const text = spec.emittedBy.map(path => readFileSync(path, "utf8")).join("\n");
      const named = id.startsWith("assistant.") || spec.emittedBy.some(path => path.endsWith("process-events.ts")) || text.includes(`"${id}"`);
      if (!named) missing.push(`${id}: not named in ${spec.emittedBy.join(", ")}`);
      // The daily job records abandoned processes in SQL.
      for (const point of [spec.entry, ...Object.keys(spec.exits)].filter((p): p is string => Boolean(p) && p !== "abandoned"))
        if (!text.includes(`"${point}"`)) missing.push(`${id}.${point}`);
    }
    expect(missing, `Declared but never emitted: ${missing.join(", ")}`).toEqual([]);
  });

  it("records abandoned processes for every customer capability that has an entry", () => {
    const sql = readFileSync("supabase/migrations/20261119140000_capability_events.sql", "utf8");
    expect(sql).toContain("'abandoned'");
    for (const [id, spec] of Object.entries(customerCapabilities)) if (spec.entry) expect(Object.keys(spec.exits), id).toContain("abandoned");
  });
});
