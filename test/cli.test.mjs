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
const cliPath = path.join(root, 'src', 'cli.mjs');

function runCli(args, environment = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// A minimal stand-in for the desktop bridge: enough to exercise the adapter, and it
// records what it received so the tests can assert on the wire format.
async function startBridge(t, { token = 'test-token-1234567890' } = {}) {
  const seen = [];
  const server = http.createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    if (request.method !== 'POST' || request.url !== '/tool' || request.headers['x-modmind-token'] !== token) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    const body = JSON.parse(text);
    seen.push({ headers: request.headers, body });
    if (body.action === 'explode') {
      response.writeHead(400);
      response.end('action failed on purpose');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ action: body.action, input: body.input, ok: true }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  return { server, seen, token, port: server.address().port };
}

async function writeConfig(t, contents) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'modmind-cli-test-'));
  const config = path.join(directory, 'bridge.json');
  await fs.writeFile(config, typeof contents === 'string' ? contents : JSON.stringify(contents));
  return config;
}

test('call sends the documented request shape and prints the JSON result', async (t) => {
  const bridge = await startBridge(t);
  const config = await writeConfig(t, { port: bridge.port, token: bridge.token, version: 'test' });
  const result = await runCli(['--config', config, 'call', 'project_info', '--json']);
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), { action: 'project_info', input: {}, ok: true });
  assert.equal(bridge.seen.length, 1);
  assert.deepEqual(bridge.seen[0].body, { action: 'project_info', input: {} });
  assert.equal(bridge.seen[0].headers['x-modmind-token'], bridge.token);
  assert.equal(bridge.seen[0].headers['content-type'], 'application/json');
});

test('call forwards --input as the action input', async (t) => {
  const bridge = await startBridge(t);
  const config = await writeConfig(t, { port: bridge.port, token: bridge.token });
  const result = await runCli(['--config', config, 'call', 'project_search', '--input', '{"query":"hi"}', '--json']);
  assert.equal(result.code, 0);
  assert.deepEqual(bridge.seen[0].body.input, { query: 'hi' });
});

test('MODMIND_BRIDGE_CONFIG is honoured like the MCP server does', async (t) => {
  const bridge = await startBridge(t);
  const config = await writeConfig(t, { port: bridge.port, token: bridge.token });
  const result = await runCli(['probe', '--json'], { MODMIND_BRIDGE_CONFIG: config });
  assert.equal(result.code, 0);
  assert.equal(bridge.seen[0].body.action, 'mcp_probe');
});

test('a missing bridge.json explains how to start one', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'modmind-cli-missing-'));
  const result = await runCli(['--config', path.join(directory, 'bridge.json'), 'doctor']);
  assert.equal(result.code, 3);
  assert.match(result.stderr, /No bridge.json at/);
  assert.match(result.stderr, /--mcp-bridge --project/);
});

test('a rejected token is reported as a stale bridge, not as a generic error', async (t) => {
  const bridge = await startBridge(t, { token: 'a-different-token-0987654321' });
  const config = await writeConfig(t, { port: bridge.port, token: 'test-token-1234567890' });
  const result = await runCli(['--config', config, 'call', 'project_info']);
  assert.equal(result.code, 3);
  assert.match(result.stderr, /404/);
  assert.match(result.stderr, /token/);
});

test('a closed port is reported as a stopped bridge', async (t) => {
  const bridge = await startBridge(t);
  const config = await writeConfig(t, { port: bridge.port, token: bridge.token });
  await new Promise((resolve) => bridge.server.close(resolve));
  const result = await runCli(['--config', config, 'probe']);
  assert.equal(result.code, 3);
  assert.match(result.stderr, /listening|stopped/i);
});

test('an action failure surfaces the bridge text and exits 4', async (t) => {
  const bridge = await startBridge(t);
  const config = await writeConfig(t, { port: bridge.port, token: bridge.token });
  const result = await runCli(['--config', config, 'call', 'explode']);
  assert.equal(result.code, 4);
  assert.match(result.stderr, /action failed on purpose/);
});

test('--dry-run prints the request and never contacts the bridge', async (t) => {
  const bridge = await startBridge(t);
  const config = await writeConfig(t, { port: bridge.port, token: bridge.token });
  const result = await runCli(['--config', config, 'call', 'project_info', '--dry-run', '--json']);
  assert.equal(result.code, 0);
  const printed = JSON.parse(result.stdout);
  assert.equal(printed.dryRun, true);
  assert.equal(printed.headers['x-modmind-token'], '<redacted>');
  assert.deepEqual(printed.body, { action: 'project_info', input: {} });
  assert.equal(bridge.seen.length, 0);
});

test('doctor reports status without ever printing the token', async (t) => {
  const bridge = await startBridge(t);
  const config = await writeConfig(t, { port: bridge.port, token: bridge.token });
  const result = await runCli(['--config', config, 'doctor', '--json']);
  assert.equal(result.code, 0);
  assert.ok(!result.stdout.includes(bridge.token), 'the token must not be printed');
  assert.ok(!result.stderr.includes(bridge.token), 'the token must not be printed');
  assert.equal(JSON.parse(result.stdout).ok, true);
});

test('MCP tool names are refused instead of being mapped by prefix', async () => {
  const result = await runCli(['call', 'modmind_validate_content']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /bridge action, not an MCP tool name/);
  assert.match(result.stderr, /content_validate/);
});

test('malformed input is a usage error', async (t) => {
  const bridge = await startBridge(t);
  const config = await writeConfig(t, { port: bridge.port, token: bridge.token });
  const badJson = await runCli(['--config', config, 'call', 'project_info', '--input', '{not json']);
  assert.equal(badJson.code, 2);
  const notObject = await runCli(['--config', config, 'call', 'project_info', '--input', '[1,2]']);
  assert.equal(notObject.code, 2);
  assert.equal(bridge.seen.length, 0);
});

test('an invalid bridge.json is rejected with the same wording as the MCP server', async (t) => {
  const config = await writeConfig(t, { port: 0, token: 'test-token-1234567890' });
  const badPort = await runCli(['--config', config, 'doctor']);
  assert.equal(badPort.code, 3);
  assert.match(badPort.stderr, /valid TCP port/);
  const shortToken = await writeConfig(t, { port: 41234, token: 'short' });
  const small = await runCli(['--config', shortToken, 'doctor']);
  assert.equal(small.code, 3);
  assert.match(small.stderr, /bridge token/);
});
  
test('unknown options and commands are usage errors', async () => {
  const unknownOption = await runCli(['call', 'project_info', '--nope']);
  assert.equal(unknownOption.code, 2);
  const unknownCommand = await runCli(['frobnicate']);
  assert.equal(unknownCommand.code, 2);
});
