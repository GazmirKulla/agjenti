import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { actions } from "@/lib/business-assistant/model";
import { operationCatalog } from "@/lib/actions/operations/catalog";
import { assistantCapability } from "./assistant-events";
import { capabilities, customerCapabilities, processToolCapability, scheduledJobCapability, scheduledJobs } from "./capabilities";

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
      const job = Object.keys(scheduledJobs).find(name => scheduledJobCapability(name) === id);
      const named = id.startsWith("assistant.") || spec.emittedBy.some(path => path.endsWith("process-events.ts")) || text.includes(`"${id}"`)
        || (job !== undefined && text.includes(`trackScheduledJob("${job}"`));
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

  it("tracks every scheduled job and every background job of the platform", () => {
    const folders = readdirSync("src/app/api/cron").filter(name => statSync(join("src/app/api/cron", name)).isDirectory());
    const scheduled = (JSON.parse(readFileSync("vercel.json", "utf8")).crons as { path: string }[]).map(cron => cron.path.replace("/api/cron/", ""));
    const missing = [...new Set([...folders, ...scheduled])].filter(job => !(job in scheduledJobs)
      || !readFileSync(join("src/app/api/cron", job, "route.ts"), "utf8").includes(`trackScheduledJob("${job}"`));
    expect(missing, `Scheduled jobs without tracking: add them to scheduledJobs and wrap GET with trackScheduledJob: ${missing.join(", ")}`).toEqual([]);
    // Every queue that claims work (a claim_* RPC) records its steps.
    // Claims that are locks of a request, not queues: an operation's idempotency (tracked as an Assistant
    // capability), the panel chat's stream and a booking's Google sync (tracked in google.ts).
    const locks = new Set(["claim_business_operation", "claim_panel_chat", "claim_booking_sync"]);
    const queues = source.filter(path => [...readFileSync(path, "utf8").matchAll(/rpc\("(claim_[a-z_]+)"/g)].some(m => !locks.has(m[1])));
    const untracked = queues.filter(path => !Object.values(capabilities).some(spec => spec.emittedBy.includes(path)));
    expect(untracked, `Queues without tracking: record their steps with recordStepFailed/recordCompleted: ${untracked.join(", ")}`).toEqual([]);
  });
});
