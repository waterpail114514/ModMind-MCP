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
    response.end(JSON.stringify(body.action === 'asset_preview_advanced'
      ? {selectedCandidateId: 'base', candidates: [{variantId: 'base', captures: [{view: 'north', width: 128, height: 128, dataUrl: 'data:image/png;base64,AA=='}]}]}
      : body.action === 'blockbench_capture_views' || body.action === 'asset_preview_intent' || body.action === 'asset_preview_refinement'
      ? {
          revision: `sha256:${'a'.repeat(64)}`,
          captures: [{ view: 'north', width: 128, height: 128, dataUrl: 'data:image/png;base64,AA==' }]
        }
      : { action: body.action, input: body.input, ok: true }));
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
  const initialized = await waitForLine();
  assert.equal(initialized.result.serverInfo.version, 'test');
  assert.equal(initialized.result._meta['dev.modmind/source-fingerprint'], 'sha256:235b5b247370dc5069a627962c848fb0d80f557114a51f51ebf5610db303f504');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
  const listed = await waitForLine();
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_project_info'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_project_files'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_blockbench_project_state'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_blockbench_validate'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_blockbench_capture_views'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_asset_compile_intent'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_asset_preview_intent'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_asset_apply_intent'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_asset_compile_refinement'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_asset_preview_refinement'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_asset_apply_refinement'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_asset_preview_advanced'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_asset_apply_advanced'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_asset_preview_reference'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_asset_visual_review'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_blockbench_history'));
  // Synced with the desktop bridge: every desktop tool must stay listed here.
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_maven_dependency_install'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_addon_relationships'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_addon_prepare'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_addon_import'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_addon_link_project'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_modpack_migration_targets'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_modpack_migration_preview'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_modpack_migration_apply'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_modpack_migration_history'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_modpack_migration_undo'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_modpack_download_content'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_scan_java_homes'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_probe_java_home'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_get_app_settings'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_set_app_setting'));
  const applyPlanTool = listed.result.tools.find((tool) => tool.name === 'modmind_modpack_apply_plan');
  assert.equal(applyPlanTool.description, 'Download and hash-lock every resolved mod in a validated modpack plan.');
  assert.deepEqual(applyPlanTool.inputSchema.required, ['plan']);
  assert.deepEqual(Object.keys(applyPlanTool.inputSchema.properties), ['plan']);
  const actionTool = listed.result.tools.find((tool) => tool.name === 'modmind_blockbench_actions');
  assert.equal(actionTool.inputSchema.additionalProperties, false);
  assert.equal(actionTool.inputSchema.properties.actions.minItems, 1);
  assert.ok(Array.isArray(actionTool.inputSchema.$defs.action.oneOf));
  const actionTypes = actionTool.inputSchema.$defs.action.oneOf.map((schema) => schema.properties.type.const);
  assert.ok(actionTypes.includes('update-cube'));
  assert.ok(actionTypes.includes('update-group'));
  assert.ok(actionTypes.includes('add-mesh'));
  assert.ok(actionTypes.includes('paint-texture'));
  assert.ok(actionTypes.includes('add-armature'));
  assert.ok(actionTypes.includes('set-vertex-weights'));
  assert.ok(actionTypes.includes('add-ik-target'));
  assert.ok(!actionTypes.includes('set-asset-metadata'));
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'modmind_project_info', arguments: {} } }) + '\n');
  const called = await waitForLine();
  assert.deepEqual(JSON.parse(called.result.content[0].text), { action: 'project_info', input: {}, ok: true });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'modmind_blockbench_capture_views', arguments: { views: ['north'], width: 128, height: 128 } } }) + '\n');
  const captured = await waitForLine();
  assert.equal(captured.result.content[0].type, 'text');
  assert.equal(captured.result.content[1].type, 'image');
  assert.equal(captured.result.content[1].mimeType, 'image/png');
  assert.equal(captured.result.content[1].data, 'AA==');
  assert.equal(JSON.parse(captured.result.content[0].text).captures[0].dataUrl, undefined);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'modmind_asset_preview_intent', arguments: { intent: {version:1,metadata:{name:'Preview'},model:{format:'java_block',parts:[{id:'body',kind:'body',size:[8,8,8]}]}} } } }) + '\n');
  const previewed = await waitForLine();
  assert.equal(previewed.result.content[1].type, 'image');
  assert.equal(previewed.result.content[1].data, 'AA==');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'modmind_asset_preview_refinement', arguments: { refinement: {version:1,metadata:{name:'Refine'},parts:[{id:'body',size:[7,8,8]}]} } } }) + '\n');
  const refined = await waitForLine();
  assert.equal(refined.result.content[1].type, 'image');
  assert.equal(refined.result.content[1].data, 'AA==');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'modmind_asset_preview_advanced', arguments: { program: {version:1,metadata:{name:'Curve'},model:{primitives:[{id:'arc',type:'tube',path:[[0,0,0],[1,2,0]],radius:1}]}} } } }) + '\n');
  const advanced = await waitForLine();
  assert.equal(advanced.result.content[1].type, 'image');
  assert.equal(advanced.result.content[1].data, 'AA==');
  assert.equal(JSON.parse(advanced.result.content[0].text).candidates[0].captures[0].dataUrl, undefined);
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

test('merges user plugin tools from the bridge and forwards plugin calls', async (t) => {
  const token = 'test-token-1234567890';
  const bridgeCalls = [];
  let registryUpdated = false;
  const bridge = http.createServer(async (request, response) => {
    if (request.headers['x-modmind-token'] !== token) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    let text = '';
    for await (const chunk of request) text += chunk;
    const body = JSON.parse(text);
    bridgeCalls.push(body.action);
    if (body.action === 'plugin_tools') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        tools: [
          {
            name: registryUpdated ? 'modmind_plugin_weather_lookup_forecast' : 'modmind_plugin_weather_lookup_current',
            description: '[Weather] Looks up current weather.',
            inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
            annotations: { readOnlyRemote: true }
          },
          { name: 'not-a-plugin-tool', description: 'invalid name should be filtered' }
        ]
      }));
      return;
    }
    if (body.action === 'plugin_tool_call') {
      registryUpdated = true;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ tool: body.input.tool, city: body.input.input?.city, ok: true }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ action: body.action, ok: true }));
  });
  bridge.listen(0, '127.0.0.1');
  await once(bridge, 'listening');
  t.after(() => bridge.close());
  const address = bridge.address();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'modmind-mcp-plugin-test-'));
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
  await waitForLine();
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
  const listed = await waitForLine();
  const pluginTool = listed.result.tools.find((tool) => tool.name === 'modmind_plugin_weather_lookup_current');
  assert.ok(pluginTool, 'plugin tool must be merged into tools/list');
  assert.equal(pluginTool.annotations.readOnlyHint, true);
  assert.equal(pluginTool.annotations.openWorldHint, true);
  assert.ok(!listed.result.tools.some((tool) => tool.name === 'not-a-plugin-tool'), 'malformed descriptors must be filtered');

  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'modmind_plugin_weather_lookup_current', arguments: { city: 'Beijing' } } }) + '\n');
  const called = await waitForLine();
  assert.deepEqual(JSON.parse(called.result.content[0].text), { tool: 'modmind_plugin_weather_lookup_current', city: 'Beijing', ok: true });
  assert.ok(bridgeCalls.includes('plugin_tool_call'));

  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} }) + '\n');
  const refreshed = await waitForLine();
  assert.ok(refreshed.result.tools.some((tool) => tool.name === 'modmind_plugin_weather_lookup_forecast'));
  assert.ok(!refreshed.result.tools.some((tool) => tool.name === 'modmind_plugin_weather_lookup_current'));
  assert.ok(refreshed.result.tools.some((tool) => tool.name === 'modmind_plugins_scaffold'));

  // Unknown non-plugin tool must still be rejected locally.
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'definitely_missing_tool', arguments: {} } }) + '\n');
  const missing = await waitForLine();
  assert.equal(missing.error.code, -32601);
});

test('falls back to the static tool list when the bridge has no plugin support', async (t) => {
  const token = 'test-token-1234567890';
  const bridge = http.createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    JSON.parse(text);
    response.writeHead(400, { 'content-type': 'text/plain' });
    response.end('Unknown action');
  });
  bridge.listen(0, '127.0.0.1');
  await once(bridge, 'listening');
  t.after(() => bridge.close());
  const address = bridge.address();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'modmind-mcp-legacy-test-'));
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
  await waitForLine();
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
  const listed = await waitForLine();
  assert.ok(listed.result.tools.some((tool) => tool.name === 'modmind_project_info'));
  assert.ok(!listed.result.tools.some((tool) => tool.name.startsWith('modmind_plugin_')), 'legacy bridges contribute no plugin tools');
});
