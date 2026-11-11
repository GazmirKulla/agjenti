import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { expect, it } from "vitest";
import { listPromptFiles, parsePromptFile, placeholders, prompt } from "./files";

it("reads the description and keeps the prompt text exactly", () => {
  const file = parsePromptFile("x", "---\ntitulli: Prova\nperdorimi: Për testin\n---\n Rreshti i parë\n\nRreshti {{emri}} \n");
  expect(file.meta).toEqual({ titulli: "Prova", perdorimi: "Për testin" });
  expect(file.body).toBe(" Rreshti i parë\n\nRreshti {{emri}} ");
  expect(placeholders(file.body)).toEqual(["emri"]);
});

it("refuses a prompt with a part left unfilled", () => {
  expect(() => prompt("katalogu/importi-csv")).toThrow(/mungon fushat/);
  expect(prompt("katalogu/importi-csv", { fushat: "name, sku" })).toContain("name, sku");
});

it("has a described file for every prompt the code reads, and no unused file", () => {
  const files = listPromptFiles();
  expect(files.length).toBeGreaterThanOrEqual(30);
  for (const file of files) {
    expect(file.meta.titulli, file.path).toBeTruthy();
    expect(file.meta.perdorimi, file.path).toBeTruthy();
    expect(file.body.trim().length, file.path).toBeGreaterThan(50);
  }
  const source = execSync("grep -rhoE 'prompts?\\(\"[a-z0-9/-]+\"|\"(agjenti-i-klienteve|asistenti|udhezimet|burimet|katalogu|onboarding)/[a-z0-9/-]+\"' src --include=*.ts").toString();
  const used = new Set([...source.matchAll(/"([a-z0-9-]+\/[a-z0-9/-]+)"/g)].map((match) => match[1]));
  expect(files.map((file) => file.path).filter((path) => !used.has(path))).toEqual([]);
  for (const path of used) expect(() => readFileSync(`prompts/${path}.md`), path).not.toThrow();
});
