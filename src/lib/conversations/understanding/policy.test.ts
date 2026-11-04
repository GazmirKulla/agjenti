import { expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
function files(path: string): string[] {
  return readdirSync(path,{withFileTypes:true}).flatMap(e=> e.isDirectory() ? files(join(path,e.name)) : e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [join(path,e.name)] : []);
}
it("keeps unit-language fixtures out of runtime imports", () => {
  const violations: string[]=[];
  for(const path of files(join(process.cwd(),"src/lib"))) {
    const source=ts.createSourceFile(path,readFileSync(path,"utf8"),ts.ScriptTarget.Latest,true);
    source.forEachChild(node=>{
      if(ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
        && /(?:\/test\/|fixtures\/|semantic-fixtures)/.test(node.moduleSpecifier.text)) violations.push(relative(process.cwd(),path));
    });
  }
  expect(violations).toEqual([]);
});
it("rejects word regexes and literal phrase checks against customer message inputs", () => {
  const violations: string[]=[];
  const roots=["conversations","workflows","agents"];
  for(const path of roots.flatMap(root=>files(join(process.cwd(),"src/lib",root)))) {
    const source=ts.createSourceFile(path,readFileSync(path,"utf8"),ts.ScriptTarget.Latest,true);
    function visit(node: ts.Node) {
      if(ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const call=node.expression, method=call.name.text, receiver=call.expression;
        const customerInput=(n:ts.Node)=>/\b(?:message|customerMessage)\b/.test(n.getText(source))
          && !/\b\w*(?:error|err)\??\.message/i.test(n.getText(source));
        const regex=ts.isRegularExpressionLiteral(receiver) ? receiver.text : "";
        const words=regex.replace(/\\p\{[^}]+\}/g,"").match(/[a-zA-ZÀ-ž]{3,}/g);
        if(method==="test" && regex && words?.length && node.arguments.some(customerInput)
          || ["includes","startsWith","endsWith"].includes(method) && customerInput(receiver)
            && node.arguments.some(a=>ts.isStringLiteral(a) && /[a-zA-ZÀ-ž]/.test(a.text) && !a.text.startsWith("[["))) {
          violations.push(`${relative(process.cwd(),path)}:${source.getLineAndCharacterOfPosition(node.pos).line+1}`);
        }
      }
      ts.forEachChild(node,visit);
    }
    visit(source);
  }
  expect(violations).toEqual([]);
});
