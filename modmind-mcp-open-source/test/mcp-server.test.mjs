import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(root, 'src', 'mcp-server.mjs');

function requestServer(port, token, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path: '/tool', method: 'POST', headers: { 'content-type': 'application/json', 'x-modmind-token': token, ...headers } }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, text }));
    });
    request.on('error', reject);
    request.end(JSON.stringify(body));
  });
}

test('implements MCP initialize, tools/list, and tools/call over stdio', async (t) => {
  const token = 'test-token-1234567890';
  const bridge = http.createServer(async (request, response) => {
    if (request.headers['x-modmind-token'] !== token) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    let text = '';
    for await (const chunk of request) text += chunk;
    const body = JSON.parse(text);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ action: body.action, input: body.input, ok: true }));
  });
  bridge.listen(0, '127.0.0.1');
  await once(bridge, 'listening');
  t.after(() => bridge.close());
  const address = bridge.address();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'modmind-mcp-test-'));
  const config = path.join(temp, 'bridge.json');
  await fs.writeFile(config, JSON.stringify({ port: address.port, token, version: 'test' }));
  const child = spawn(process.execPath, [serverPath], { env: { ...process.env, MODMIND_BRIDGE_CONFIG: config }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const lines = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => lines.push(...chunk.split(/\r?\n/).filter(Boolean)));
  const waitForLine = async () => {
    while (lines.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    return JSON.parse(lines.shift());
  };

  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
  assert.equal((await waitForLine()).result.serverInfo.version, 'test');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
  const listed = await waitForLine();
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_project_info'));
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'modmind_project_info', arguments: {} } }) + '\n');
  const called = await waitForLine();
  assert.deepEqual(JSON.parse(called.result.content[0].text), { action: 'project_info', input: {}, ok: true });
});

test('rejects unknown MCP tools without contacting a bridge', async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'modmind-mcp-test-'));
  const config = path.join(temp, 'bridge.json');
  await fs.writeFile(config, JSON.stringify({ port: 1, token: 'test-token-1234567890' }));
  const child = spawn(process.execPath, [serverPath], { env: { ...process.env, MODMIND_BRIDGE_CONFIG: config }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  let text = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { text += chunk; });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'does_not_exist', arguments: {} } }) + '\n');
  while (!text.trim()) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(JSON.parse(text).error.code, -32601);
});

test('bridge contract rejects an invalid token', async () => {
  const token = 'test-token-1234567890';
  const bridge = http.createServer((request, response) => {
    if (request.headers['x-modmind-token'] !== token) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    response.writeHead(200);
    response.end('{}');
  });
  bridge.listen(0, '127.0.0.1');
  await once(bridge, 'listening');
  const address = bridge.address();
  const result = await requestServer(address.port, 'wrong-token-123456', { action: 'project_info', input: {} });
  assert.equal(result.status, 404);
  await new Promise((resolve) => bridge.close(resolve));
});
