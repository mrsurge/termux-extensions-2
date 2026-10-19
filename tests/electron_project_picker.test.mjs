import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const result=spawnSync(fileURLToPath(new URL('../desktop_client/electron/node_modules/electron/dist/electron',import.meta.url)),
  ['--no-sandbox',fileURLToPath(new URL('./electron_project_picker_fixture.cjs',import.meta.url))],
  {env,encoding:'utf8',timeout:45000,maxBuffer:1024*1024});
assert.equal(result.status,0,result.error?.message||result.stdout+result.stderr);
assert.match(result.stdout,/populated floating picker passed: 3 cycles/,result.stderr);
console.log(result.stdout.trim());
