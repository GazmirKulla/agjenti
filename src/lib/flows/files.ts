import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePromptFile } from "@/lib/ai/prompts/files";

/** How the platform's flows work (activation, approval…), written as readable
 * files in /rrjedhat so the rules can be read in the admin panel and changed
 * later together with the code. Read-only. */
export const FLOWS_DIR = join(process.cwd(), "rrjedhat");

export function listFlows() {
  return readdirSync(FLOWS_DIR).filter((name) => name.endsWith(".md")).sort()
    .map((name) => parsePromptFile(name.replace(/\.md$/, ""), readFileSync(join(FLOWS_DIR, name), "utf8")));
}
