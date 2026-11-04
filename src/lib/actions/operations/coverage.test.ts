import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import { manualSurfaces } from "./manual-surfaces";
import { assistantOperationCatalog, operationCatalog, parseOperation } from "./catalog";

function boundaries(root: string): string[] {
  const found: string[] = [];
  function walk(directory: string) {
    for (const file of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, file.name);
      if (file.isDirectory()) { walk(path); continue; }
      if (!/\.tsx?$/.test(path) || /\.(test|spec)\./.test(path)) continue;
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
      const directive = (node: ts.Node) => ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression) && node.expression.text === "use server";
      const serverModule = source.statements.some(directive);
      const exported = (node: ts.Node) => ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
      const route = file.name === "route.ts";
      function visit(node: ts.Node) {
        if (ts.isFunctionDeclaration(node) && node.name && (node.body?.statements.some(directive) || exported(node) && (serverModule || route && /^(POST|PUT|PATCH|DELETE)$/.test(node.name.text))))
          found.push(`${relative(process.cwd(), path)}#${node.name.text}`);
        if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
          const value = declaration.initializer;
          const inline = (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) && ts.isBlock(value.body) && value.body.statements.some(directive);
          if (inline || exported(node) && (serverModule || route && /^(POST|PUT|PATCH|DELETE)$/.test(declaration.name.text)))
            found.push(`${relative(process.cwd(), path)}#${declaration.name.text}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  walk(root); return found.sort();
}
it("requires every manual action or mutating HTTP boundary to declare assistant coverage or a concrete exception", () => {
  expect(boundaries(join(process.cwd(), "src"))).toEqual(Object.keys(manualSurfaces).sort());
  for (const entry of Object.values(manualSurfaces)) if ("exception" in entry) expect(entry.exception.length).toBeGreaterThan(25);
});
it("exposes every registered operation to the owner with confirmation and rejects undeclared fields", () => {
  const available = assistantOperationCatalog();
  expect(available.map(op => op.key)).toEqual(Object.keys(operationCatalog));
  for (const operation of available) {
    expect(operation.audience).toBe("business_owner");
    expect(operation.confirmation).toBe("required");
    expect(() => parseOperation(operation.key, { business_id: "another-business" })).toThrow();
  }
  expect(() => parseOperation("__proto__", {})).toThrow();
  expect(() => parseOperation("product.delete", { id: "x", skipConfirmation: true })).toThrow();
});
