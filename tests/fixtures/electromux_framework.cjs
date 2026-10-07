#!/usr/bin/env node
const fs = require('node:fs');
const http = require('node:http');
if (process.argv.includes('--build-only')) {
  console.log(`build-pid=${process.pid}`);
  setTimeout(() => process.exit(Number(process.env.TEST_BUILD_EXIT || 0)), Number(process.env.TEST_BUILD_DELAY || 0));
} else {
  const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({status: 'ok', app: 'te2', port, instanceId: 'fixture', version: 'test'}));
  }).listen(port, '127.0.0.1', () => {
    fs.writeSync(3, JSON.stringify({version: 1, type: 'hello', capabilities: ['shutdown']}) + '\n');
    console.log('ordinary stdout is not host IPC');
  });
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', text => {
    if (JSON.parse(text).method === 'shutdown') server.close(() => process.exit(0));
  });
}
