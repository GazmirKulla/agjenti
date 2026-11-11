import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** The platform's AI prompts live as readable Markdown files in /prompts, one
 * per prompt, so they can be read and edited as files and keep their git
 * history. Each file starts with a short description (between --- lines) and
 * then the exact prompt text. {{name}} marks a part filled for each request. */

export const PROMPTS_DIR = join(process.cwd(), "prompts");

export type PromptFile = { path: string; meta: Record<string, string>; body: string };

const cache = new Map<string, PromptFile>();
// In development an edited file is read again; in production once per server.
const cached = process.env.NODE_ENV === "production";

export function parsePromptFile(path: string, content: string): PromptFile {
  const text = content.replace(/\r\n/g, "\n");
  const meta: Record<string, string> = {};
  let body = text;
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---\n", 4);
    if (end < 0) throw new Error(`Prompt ${path}: përshkrimi në krye nuk mbyllet me ---`);
    for (const line of text.slice(4, end).split("\n")) {
      const colon = line.indexOf(":");
      if (colon > 0) meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
    body = text.slice(end + 5);
  }
  // The file ends with one newline that is not part of the prompt.
  return { path, meta, body: body.endsWith("\n") ? body.slice(0, -1) : body };
}

export function readPrompt(path: string): PromptFile {
  const hit = cached ? cache.get(path) : undefined;
  if (hit) return hit;
  let content: string;
  try { content = readFileSync(join(PROMPTS_DIR, `${path}.md`), "utf8"); }
  catch { throw new Error(`Prompti "${path}" nuk u gjet te prompts/${path}.md`); }
  const file = parsePromptFile(path, content);
  if (cached) cache.set(path, file);
  return file;
}

/** The prompt text with its {{parts}} filled. A missing part is an error, never empty text. */
export function prompt(path: string, values: Record<string, string> = {}): string {
  const missing = new Set<string>();
  const text = readPrompt(path).body.replace(/\{\{([a-z_]+)\}\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];
    missing.add(key);
    return match;
  });
  if (missing.size) throw new Error(`Prompti "${path}": mungon ${[...missing].join(", ")}`);
  return text;
}

/** Every prompt file, for the admin catalog and the tests. */
export function listPromptFiles(dir = PROMPTS_DIR): PromptFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listPromptFiles(full);
    if (!entry.name.endsWith(".md") || entry.name === "README.md") return [];
    const path = relative(PROMPTS_DIR, full).split(sep).join("/").replace(/\.md$/, "");
    return [readPrompt(path)];
  }).sort((a, b) => a.path.localeCompare(b.path));
}

export function placeholders(body: string) {
  return [...new Set([...body.matchAll(/\{\{([a-z_]+)\}\}/g)].map((match) => match[1]))];
}
