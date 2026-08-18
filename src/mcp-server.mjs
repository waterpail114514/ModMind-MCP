#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

// The desktop application writes bridge.json next to this file for each
// project. MODMIND_BRIDGE_CONFIG is useful for package managers and tests.
const configPath = process.env.MODMIND_BRIDGE_CONFIG
  ? path.resolve(process.env.MODMIND_BRIDGE_CONFIG)
  : path.join(path.dirname(path.resolve(process.argv[1])), 'bridge.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error('bridge.json must contain a valid TCP port');
}
if (typeof config.token !== 'string' || config.token.length < 16) {
  throw new Error('bridge.json must contain a non-empty bridge token');
}

const endpoint = `http://127.0.0.1:${config.port}/tool`;
const readOnlyLocal = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const readOnlyRemote = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const safeStateChange = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const managedAction = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

async function callTool(action, input) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-modmind-token': config.token },
    body: JSON.stringify({ action, input: input || {} })
  });
  const body = await response.text();
  if (!response.ok) throw new Error(body || `ModMind tool failed: ${response.status}`);
  return JSON.parse(body);
}

const tools = [
  { name: 'modmind_project_info', description: 'Read active ModMind project metadata and integration rules.', inputSchema: { type: 'object', properties: {} }, annotations: readOnlyLocal },
  { name: 'modmind_rename_project', description: 'Rename the active project and migrate project-owned namespace references. Use only when explicitly requested.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, namespace: { type: 'string' } }, required: ['name', 'namespace'] }, annotations: managedAction },
  { name: 'modmind_set_intent', description: 'Label the current task as engineering or informational.', inputSchema: { type: 'object', properties: { intent: { type: 'string', enum: ['engineering', 'informational'] }, reason: { type: 'string' } }, required: ['intent', 'reason'] }, annotations: safeStateChange },
  { name: 'modmind_apply_edits', description: 'Apply exact project-relative text edits. Existing files require oldText to match exactly once.', inputSchema: { type: 'object', properties: { edits: { type: 'array', minItems: 1, items: { type: 'object', properties: { path: { type: 'string' }, purpose: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['path', 'newText'] } } }, required: ['edits'] }, annotations: managedAction },
  { name: 'modmind_update_todo', description: 'Publish a task list to the ModMind progress UI.', inputSchema: { type: 'object', properties: { tasks: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] } }, required: ['id', 'title', 'status'] } } }, required: ['tasks'] }, annotations: safeStateChange },
  { name: 'modmind_mapping_search', description: 'Search mappings.dev for the active Minecraft version.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] }, annotations: readOnlyRemote },
  { name: 'modmind_mapping_class', description: 'Inspect an exact mapped Minecraft class and optional member query.', inputSchema: { type: 'object', properties: { className: { type: 'string' }, memberQuery: { type: 'string' } }, required: ['className'] }, annotations: readOnlyRemote },
  { name: 'modmind_dependency_search', description: 'Search Modrinth for projects compatible with the active loader and Minecraft version.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, offset: { type: 'number' } }, required: ['query'] }, annotations: readOnlyRemote },
  { name: 'modmind_dependency_install', description: 'Install a compatible Modrinth dependency through managed Gradle integration.', inputSchema: { type: 'object', properties: { projectId: { type: 'string' }, versionId: { type: 'string' } }, required: ['projectId'] }, annotations: managedAction },
  { name: 'modmind_validate_content', description: 'Validate project JSON, OGG headers, and sound references without changing files.', inputSchema: { type: 'object', properties: {} }, annotations: readOnlyLocal },
  { name: 'modmind_test_matrix', description: 'Run selected managed build, client, server, or GameTest targets.', inputSchema: { type: 'object', properties: { targets: { type: 'array', items: { type: 'string', enum: ['build', 'client', 'server', 'gametest'] } } }, required: ['targets'] }, annotations: managedAction },
  { name: 'modmind_release_preflight', description: 'Inspect release artifact, metadata, license, version, and changelog readiness.', inputSchema: { type: 'object', properties: {} }, annotations: readOnlyLocal },
  { name: 'modmind_build_project', description: 'Run the managed Gradle build and return the artifact or diagnostics.', inputSchema: { type: 'object', properties: {} }, annotations: managedAction },
  { name: 'modmind_test_minecraft', description: 'Build and launch the isolated Minecraft test instance and return startup evidence.', inputSchema: { type: 'object', properties: {} }, annotations: managedAction },
  { name: 'modmind_modpack_plan', description: 'Resolve a modpack concept into compatible candidates and return conflicts without downloading.', inputSchema: { type: 'object', properties: { required: { type: 'array', items: { type: 'string' } }, optional: { type: 'array', items: { type: 'string' } }, excluded: { type: 'array', items: { type: 'string' } }, providers: { type: 'array', items: { type: 'string', enum: ['modrinth', 'curseforge'] } }, maxMods: { type: 'number' } }, required: ['required'] }, annotations: managedAction },
  { name: 'modmind_modpack_apply_plan', description: 'Download and hash-lock every resolved mod in a validated plan.', inputSchema: { type: 'object', properties: { plan: { type: 'object' } }, required: ['plan'] }, annotations: managedAction },
  { name: 'modmind_mcmod_search', description: 'Query MC百科 metadata when Modrinth and CurseForge have no compatible replacement. Read-only.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] }, annotations: readOnlyRemote },
  { name: 'modmind_mcmod_files', description: 'List public MC百科 file metadata for a numeric project ID. No download actions.', inputSchema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] }, annotations: readOnlyRemote },
  { name: 'modmind_modpack_write_ftb_quest', description: 'Write a validated FTB Quests chapter as SNBT into pack overrides.', inputSchema: { type: 'object', properties: { chapterId: { type: 'string' }, title: { type: 'string' }, filename: { type: 'string' }, quests: { type: 'array' } }, required: ['chapterId', 'title', 'quests'] }, annotations: managedAction },
  { name: 'modmind_modpack_write_patchouli_book', description: 'Write a validated Patchouli book, categories, entries, and pages into pack overrides.', inputSchema: { type: 'object', properties: { bookId: { type: 'string' }, name: { type: 'string' }, landingText: { type: 'string' }, categories: { type: 'array' } }, required: ['bookId', 'name', 'landingText', 'categories'] }, annotations: managedAction },
  { name: 'modmind_modpack_apply_keybinds', description: 'Apply a keybind preset to options.txt and reject conflicts by default.', inputSchema: { type: 'object', properties: { preset: { type: 'object' }, allowConflicts: { type: 'boolean' } }, required: ['preset'] }, annotations: managedAction },
  { name: 'modmind_modpack_build_server', description: 'Deterministically build the initial server pack with the pinned ServerPackCreator CLI.', inputSchema: { type: 'object', properties: { outputDirectory: { type: 'string' }, port: { type: 'number' }, acceptEula: { type: 'boolean' } } }, annotations: managedAction },
  { name: 'modmind_modpack_verify_server_join', description: 'Build a loopback-only local server and verify a HeadlessMC client joins with evidence.', inputSchema: { type: 'object', properties: { outputDirectory: { type: 'string' }, port: { type: 'number' }, acceptEula: { type: 'boolean' }, onlineMode: { type: 'boolean' } } }, annotations: managedAction },
  { name: 'modmind_modpack_apply_optimization_profile', description: 'Install a conservative optimization profile and apply declared configuration patches.', inputSchema: { type: 'object', properties: { profileId: { type: 'string' }, profile: { type: 'object' } } }, annotations: managedAction },
  { name: 'modmind_modpack_run_server_scenario', description: 'Start a bounded loopback-only server scenario and assert log evidence.', inputSchema: { type: 'object', properties: { steps: { type: 'array' }, outputDirectory: { type: 'string' }, port: { type: 'number' }, acceptEula: { type: 'boolean' }, onlineMode: { type: 'boolean' } }, required: ['steps'] }, annotations: managedAction },
  { name: 'modmind_blockbench_actions', description: 'Execute validated Blockbench actions through the embedded bridge.', inputSchema: { type: 'object', properties: { actions: { type: 'array' } }, required: ['actions'] }, annotations: managedAction },
  { name: 'modmind_runtime_state', description: 'Read the isolated Minecraft test runtime state and recent events.', inputSchema: { type: 'object', properties: {} }, annotations: readOnlyLocal },
  { name: 'modmind_image_generate', description: 'Generate a project image through the configured ModMind Image Studio service.', inputSchema: { type: 'object', properties: { prompt: { type: 'string' }, style: { type: 'string', enum: ['minecraft', 'free'] }, size: { type: 'string' }, quality: { type: 'string', enum: ['low', 'medium', 'high', 'auto'] }, moderation: { type: 'string', enum: ['auto', 'low'] }, count: { type: 'number' }, backgroundColor: { type: 'string' }, referenceImage: { type: 'string' } }, required: ['prompt'] }, annotations: managedAction },
  { name: 'modmind_image_perfect_pixel', description: 'Run pixel-art refinement on an image data URL.', inputSchema: { type: 'object', properties: { dataUrl: { type: 'string' } }, required: ['dataUrl'] }, annotations: managedAction },
  { name: 'modmind_image_remove_background', description: 'Remove an image background with the configured local model.', inputSchema: { type: 'object', properties: { dataUrl: { type: 'string' } }, required: ['dataUrl'] }, annotations: managedAction },
  { name: 'modmind_image_project_assets', description: 'List project image resources usable as reference images.', inputSchema: { type: 'object', properties: {} }, annotations: readOnlyLocal },
  { name: 'modmind_image_read_project_asset', description: 'Read one project image resource as a data URL.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, annotations: readOnlyLocal }
];

const actions = {
  modmind_project_info: 'project_info',
  modmind_rename_project: 'rename_project',
  modmind_set_intent: 'set_intent',
  modmind_apply_edits: 'apply_edits',
  modmind_update_todo: 'update_todo',
  modmind_mapping_search: 'mappings_search',
  modmind_mapping_class: 'mappings_class',
  modmind_dependency_search: 'dependency_search',
  modmind_dependency_install: 'dependency_install',
  modmind_validate_content: 'content_validate',
  modmind_test_matrix: 'test_matrix',
  modmind_release_preflight: 'release_preflight',
  modmind_build_project: 'build_project',
  modmind_test_minecraft: 'test_minecraft',
  modmind_modpack_plan: 'modpack_plan',
  modmind_modpack_apply_plan: 'modpack_apply_plan',
  modmind_mcmod_search: 'mcmod_search',
  modmind_mcmod_files: 'mcmod_files',
  modmind_modpack_write_ftb_quest: 'modpack_write_ftb_quest',
  modmind_modpack_write_patchouli_book: 'modpack_write_patchouli_book',
  modmind_modpack_apply_keybinds: 'modpack_apply_keybinds',
  modmind_modpack_build_server: 'modpack_build_server',
  modmind_modpack_verify_server_join: 'modpack_verify_server_join',
  modmind_modpack_apply_optimization_profile: 'modpack_apply_optimization_profile',
  modmind_modpack_run_server_scenario: 'modpack_run_server_scenario',
  modmind_blockbench_actions: 'blockbench_actions',
  modmind_runtime_state: 'runtime_state',
  modmind_image_generate: 'image_generate',
  modmind_image_perfect_pixel: 'image_perfect_pixel',
  modmind_image_remove_background: 'image_remove_background',
  modmind_image_project_assets: 'image_project_assets',
  modmind_image_read_project_asset: 'image_read_project_asset'
};

function rpcResult(id, value) {
  return { jsonrpc: '2.0', id, result: value };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', async (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    write(rpcError(null, -32700, 'Invalid JSON'));
    return;
  }
  if (request.method === 'notifications/initialized' || request.method?.startsWith('notifications/')) return;
  if (request.method === 'initialize') {
    write(rpcResult(request.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'modmind', version: config.version || 'development' } }));
    return;
  }
  if (request.method === 'tools/list') {
    write(rpcResult(request.id, { tools }));
    return;
  }
  if (request.method === 'tools/call') {
    const name = request.params?.name || '';
    const action = actions[name];
    if (!action) {
      write(rpcError(request.id, -32601, 'Unknown ModMind tool'));
      return;
    }
    try {
      const value = await callTool(action, request.params?.arguments || {});
      write(rpcResult(request.id, { content: [{ type: 'text', text: JSON.stringify(value) }] }));
    } catch (error) {
      write(rpcResult(request.id, { isError: true, content: [{ type: 'text', text: String(error?.message || error) }] }));
    }
    return;
  }
  write(rpcError(request.id, -32601, 'Unsupported MCP method'));
});
