import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

// Keep action entry points explicit: Turbopack can reject even type-only
// re-exports that the production Webpack build accepts.
function invalidExports(text: string): string[] {
  const source = ts.createSourceFile("module.ts", text, ts.ScriptTarget.Latest, true);
  const server = source.statements.some(node => ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression) && node.expression.text === "use server");
  if (!server) return [];
  const has = (node: ts.Node, kind: ts.SyntaxKind) => ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === kind);
  return source.statements.filter(node => {
    if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) return true;
    if (!has(node, ts.SyntaxKind.ExportKeyword)) return false;
    if (ts.isFunctionDeclaration(node)) return !has(node, ts.SyntaxKind.AsyncKeyword);
    if (ts.isVariableStatement(node)) return node.declarationList.declarations.some(declaration => {
      const value = declaration.initializer;
      return !value || !(ts.isArrowFunction(value) || ts.isFunctionExpression(value)) || !has(value, ts.SyntaxKind.AsyncKeyword);
    });
    return true;
  }).map(node => node.getText(source).split("\n")[0]);
}

it("keeps all server action modules limited to explicit async exports", () => {
  const problems: string[] = [];
  function scan(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (/\.tsx?$/.test(path) && !/\.(test|spec)\./.test(path)) {
        for (const problem of invalidExports(readFileSync(path, "utf8"))) problems.push(`${relative(process.cwd(), path)}: ${problem}`);
      }
    }
  }
  scan(join(process.cwd(), "src"));
  expect(problems).toEqual([]);
});
it.each([
  'export type { CatalogField } from "./field-command";',
  'export { type Input } from "./types";',
  'export * from "./commands";',
  'export const settings = {};',
  'export function change() {}',
  'export const change = () => Promise.resolve();',
])("rejects incompatible action exports: %s", declaration => {
  expect(invalidExports(`"use server";\n${declaration}`)).toHaveLength(1);
});
it("allows explicit async actions, internal helpers and type-only imports", () => {
  expect(invalidExports('"use server"; import type { Input } from "./types"; type Result = {}; function helper() {} export async function save(input: Input): Promise<Result> { return {}; } export const remove = async () => {};')).toEqual([]);
  expect(invalidExports('export type { Input } from "./types";')).toEqual([]);
});
