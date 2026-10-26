import ts from 'typescript';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exclusions = ['/node_modules/', '/vendor/', '/vscode_oss_src/', '/vscode_oss_runtime/',
  '/upstream/', '/vscode_widget_vendor/', '/vscode_chat_editing_vendor/',
  '/vscode_build_src/', '/build_shims/', '/static/dist/'];

export function ownedSource(filename) {
  const relative = path.relative(root, filename).replaceAll('\\', '/');
  if (/^monaco_editor\/vscode_[^/]*_vendor\//.test(relative) ||
    relative.startsWith('src/explorer/history/vscode_scm/adapted/')) return false;
  return !relative.startsWith('../') && !exclusions.some(part => `/${relative}`.includes(part)) &&
    (relative === 'main.ts' || /^(?:main_page\/frontend|monaco_editor|src|workbench_protocol_proxy\/node_workbench_adapter\/src)\//.test(relative));
}

export function auditProject(configFile, { extraSources = new Map() } = {}) {
  const config = ts.readConfigFile(configFile, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configFile));
  const host = ts.createCompilerHost(parsed.options);
  const readFile = host.readFile.bind(host), fileExists = host.fileExists.bind(host);
  host.readFile = filename => extraSources.get(filename) ?? readFile(filename);
  host.fileExists = filename => extraSources.has(filename) || fileExists(filename);
  const program = ts.createProgram([...parsed.fileNames, ...extraSources.keys()], parsed.options, host);
  const checker = program.getTypeChecker();
  const findings = [];

  function anyPath(type, seen = new Set(), depth = 0) {
    if (type.flags & ts.TypeFlags.Any) return 'any';
    if (seen.has(type)) return null;
    seen.add(type);
    if (type.isUnionOrIntersection()) {
      for (const member of type.types) { const found = anyPath(member, seen, depth + 1); if (found) return found; }
    }
    if (type.flags & ts.TypeFlags.Object) {
      if (type.objectFlags & ts.ObjectFlags.Reference) {
        for (const argument of checker.getTypeArguments(type)) {
          const found = anyPath(argument, seen, depth + 1); if (found) return `<${found}>`;
        }
      }
      for (const kind of [ts.IndexKind.String, ts.IndexKind.Number]) {
        const indexed = checker.getIndexTypeOfType(type, kind);
        if (indexed) { const found = anyPath(indexed, seen, depth + 1); if (found) return `[index]: ${found}`; }
      }
      for (const signature of [...type.getCallSignatures(), ...type.getConstructSignatures()]) {
        const found = anyPath(signature.getReturnType(), seen, depth + 1);
        if (found) return `return ${found}`;
        for (const parameter of signature.parameters) {
          const declaration = parameter.valueDeclaration;
          if (!declaration || !ownedSource(declaration.getSourceFile().fileName)) continue;
          const found = anyPath(checker.getTypeOfSymbolAtLocation(parameter, declaration), seen, depth + 1);
          if (found) return `parameter ${parameter.name}: ${found}`;
        }
      }
      for (const property of type.getProperties()) {
        const declaration = property.valueDeclaration || property.declarations?.[0];
        // Library internals are not ours to rewrite. Their generic defaults and
        // values actually consumed in owned declarations remain checked above.
        if (!declaration || !ownedSource(declaration.getSourceFile().fileName)) continue;
        const found = anyPath(checker.getTypeOfSymbolAtLocation(property, declaration), seen, depth + 1);
        if (found) return `${property.name}.${found}`;
      }
    }
    return null;
  }

  for (const source of program.getSourceFiles()) {
    if (!ownedSource(source.fileName)) continue;
    function visit(node) {
      const declaration = ts.isVariableDeclaration(node) || ts.isParameter(node) ||
        ts.isPropertyDeclaration(node) || ts.isPropertySignature(node) ||
        ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) ||
        ts.isMethodSignature(node) || ts.isTypeAliasDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) ||
        ts.isArrowFunction(node) || ts.isFunctionExpression(node) ||
        ts.isFunctionTypeNode(node) || ts.isCallSignatureDeclaration(node) ||
        ts.isConstructSignatureDeclaration(node) || ts.isConstructorTypeNode(node);
      // Signature syntax nodes do not have a value type. Querying their value
      // type returns an error-any and also merges unrelated external overloads.
      const signature = ts.isFunctionLike(node) || ts.isFunctionTypeNode(node) ||
        ts.isConstructorTypeNode(node) ? checker.getSignatureFromDeclaration(node) : null;
      const found = node.kind === ts.SyntaxKind.AnyKeyword ? 'explicit any' :
        signature ? anyPath(signature.getReturnType()) :
          declaration ? anyPath(checker.getTypeAtLocation(node.name || node)) : null;
      if (found) {
        const { line, character } = source.getLineAndCharacterOfPosition(node.getStart());
        findings.push(`${path.relative(root, source.fileName)}:${line + 1}:${character + 1} ${node.name?.getText() || 'type'}: ${found}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return { findings, diagnostics: ts.getPreEmitDiagnostics(program) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let count = 0;
  for (const relative of ['tsconfig.json', 'workbench_protocol_proxy/node_workbench_adapter/tsconfig.json']) {
    const result = auditProject(path.join(root, relative));
    if (result.diagnostics.length) console.error(ts.formatDiagnosticsWithColorAndContext(result.diagnostics, {
      getCanonicalFileName: filename => filename, getCurrentDirectory: () => root, getNewLine: () => '\n',
    }));
    for (const finding of result.findings) console.error(finding);
    count += result.findings.length + result.diagnostics.length;
    console.log(`${relative}: ${result.findings.length} Any findings, ${result.diagnostics.length} compiler diagnostics`);
  }
  process.exitCode = count ? 1 : 0;
}
