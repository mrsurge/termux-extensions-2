import ts from 'typescript';
import { readFile } from 'node:fs/promises';

/** Source resolves real TS contracts; unbundled production modules use .mjs. */
export function rewriteRuntimeImports(source, filename) {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const edits = [];
  function visit(node) {
    const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
      ? node.moduleSpecifier : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
        ? node.arguments[0] : null;
    if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith('.') && specifier.text.endsWith('.ts')) {
      edits.push([specifier.getStart(tree) + 1, specifier.getEnd() - 1,
        specifier.text.slice(0, -3) + '.mjs']);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  for (const [start, end, value] of edits.reverse()) {
    source = source.slice(0, start) + value + source.slice(end);
  }
  return source;
}

export const wbaRuntimeImports = {
  name: 'wba-runtime-imports',
  setup(builder) {
    builder.onLoad({ filter: /\.ts$/ }, async ({ path }) => ({
      contents: rewriteRuntimeImports(await readFile(path, 'utf8'), path), loader: 'ts',
    }));
  },
};
