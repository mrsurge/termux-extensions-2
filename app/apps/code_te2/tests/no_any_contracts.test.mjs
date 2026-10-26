import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { auditProject, ownedSource } from '../scripts/check-no-any.mjs';
import { rewriteRuntimeImports } from '../scripts/wba-runtime-imports.mjs';

test('compiler-backed gate rejects explicit, nested and inferred Any without matching text or unknown', () => {
  const filename = path.resolve('main_page/frontend/__no_any_gate_fixture.ts');
  const source = `export {};
    type Nested = { outer: { inner: Array<Map<string, any>> } };
    type Callback = (value: any) => Promise<any[]>;
    declare function untyped(): any;
    const leaked = untyped();
    const parsed = JSON.parse('null');
    const asserted = 1 as any;
    const angleAsserted = <any>1;
    class Broken { member: any; method(argument: any): any { return argument; } }
    const bounded: unknown = JSON.parse('null');
    const literal = 'any';
    const values: unknown[] = [];
    function safe(value: unknown): string { return typeof value === 'string' ? value : ''; }
    const clean = { nested: { values, safe } };
  `;
  const result = auditProject(path.resolve('tsconfig.json'), { extraSources: new Map([[filename, source]]) });
  const findings = result.findings.filter(line => line.includes('__no_any_gate_fixture.ts'));
  for (const name of ['Nested', 'Callback', 'untyped', 'leaked', 'parsed', 'asserted', 'angleAsserted', 'member', 'argument', 'method']) {
    assert.ok(findings.some(line => line.includes(`${name}:`)), `${name} must fail`);
  }
  for (const name of ['bounded', 'literal', 'values', 'safe', 'clean']) {
    assert.equal(findings.some(line => line.includes(`${name}:`)), false, `${name} must stay typed`);
  }
  assert.equal(result.diagnostics.length, 0);
  assert.equal(ownedSource(path.resolve('src/explorer/history/vscode_scm/tree/upstream/example.ts')), false);
  assert.equal(ownedSource(path.resolve('workbench_protocol_proxy/node_workbench_adapter/src/server/server.ts')), true);
});

test('WBA runtime extension rewrite changes only actual module specifiers', () => {
  const source = `import { value } from './value.ts';
    export { other } from '../other.ts';
    const lazy = import('./lazy.ts');
    const html = "import './do-not-touch.ts'";
    const packageName = import('external-package');`;
  const output = rewriteRuntimeImports(source, 'fixture.ts');
  assert.match(output, /from '\.\/value.mjs'/);
  assert.match(output, /from '\.\.\/other.mjs'/);
  assert.match(output, /import\('\.\/lazy.mjs'\)/);
  assert.match(output, /"import '\.\/do-not-touch.ts'"/);
  assert.match(output, /import\('external-package'\)/);
});
