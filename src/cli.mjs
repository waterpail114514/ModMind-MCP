#!/usr/bin/env node

// Command-line transport adapter for the ModMind bridge.
//
// The stdio MCP server (src/mcp-server.mjs) is one adapter for the bridge contract
// described in docs/bridge-contract.md; this is another. It exists so the same
// bridge can be driven from a shell, a script or CI without an MCP host, and so a
// missing or stale bridge.json produces an actionable error instead of an opaque one.
//
// This adapter speaks bridge *actions* (see docs/bridge-contract.md "Action families"),
// not MCP tool names: the tool-name mapping lives in src/mcp-server.mjs and is not
// duplicated here on purpose, so it cannot drift.
//
// It is a transport adapter only. Approval and review policy for state-changing
// actions stays in the host, exactly as it does for the MCP path.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_BRIDGE = 3; // bridge.json missing or unusable, or the bridge is unreachable
const EXIT_ACTION = 4; // the bridge answered, and the action failed
const KNOWN_COMMANDS = ['call', 'probe', 'doctor'];

const USAGE = [
  'Usage: modmind-bridge-cli <command> [options]',
  '',
  'Commands:',
  '  call <action>     POST one action to the bridge',
  '  probe             Round-trip the bridge with the mcp_probe action',
  '  doctor            Resolve and validate the bridge configuration, then probe it',
  '  help              Show this message',
  '',
  'Options:',
  '  --input <json>        JSON object for the action input (default {})',
  '  --input-file <path>   Read the input object from a file',
  '  --input -             Read the input object from stdin',
  '  --json                Print the raw JSON result (stdout stays pure JSON)',
  '  --pretty              Pretty-print the result (default)',
  '  --dry-run             Print the request that would be sent, then exit',
  '  --config <path>       bridge.json to use (overrides MODMIND_BRIDGE_CONFIG)',
  '  --timeout <ms>        Request timeout (default 300000)',
].join('\n');

class BridgeConfigError extends Error {}
class BridgeCallError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.name = 'BridgeCallError';
    this.exitCode = exitCode;
  }
}

// Keep this default identical to src/mcp-server.mjs so both adapters agree on where
// bridge.json lives next to the script that the host generated.
function defaultConfigPath() {
  return path.join(path.dirname(path.resolve(process.argv[1])), 'bridge.json');
}

function resolveConfigPath(explicit) {
  const fromEnv = process.env.MODMIND_BRIDGE_CONFIG;
  const chosen = explicit || fromEnv;
  return chosen ? path.resolve(chosen) : defaultConfigPath();
}

function loadBridgeConfig(configPath) {
  let text;
  try {
    text = fs.readFileSync(configPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new BridgeConfigError(
        'No bridge.json at ' + configPath + '\n' +
        'A bridge.json only exists while ModMind is running a bridge for a project.' + '\n' +
        'Start one with: ModMind.exe --mcp-bridge --project <project path>' + '\n' +
        'or point this adapter at an existing one with --config <path> / MODMIND_BRIDGE_CONFIG.'
      );
    }
    throw new BridgeConfigError('Cannot read ' + configPath + ': ' + (error.message || error));
  }
  let config;
  try {
    config = JSON.parse(text);
  } catch (error) {
    throw new BridgeConfigError('bridge.json is not valid JSON (' + configPath + '): ' + (error.message || error));
  }
  // Same validation and wording as src/mcp-server.mjs, so both adapters fail alike.
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new BridgeConfigError('bridge.json must contain a valid TCP port');
  }
  if (typeof config.token !== 'string' || config.token.length < 16) {
    throw new BridgeConfigError('bridge.json must contain a non-empty bridge token');
  }
  return config;
}

// Turn the three failure modes that a bridge user actually hits into sentences that
// say what to do next. Everything here is observed, not guessed: the host returns 404
// for a token mismatch (docs/bridge-contract.md section 5).
function describeFailure({ status, body, code, configPath }) {
  if (status === 404) {
    return {
      code: EXIT_BRIDGE,
      message: [
        'The bridge rejected the request with 404, which means the token (or the URL) no longer matches.',
        'bridge.json is usually a leftover from an earlier session: the token is regenerated every time' ,
        'the host starts a bridge, and the file is deleted when that bridge stops.',
        'Restart the bridge (ModMind.exe --mcp-bridge --project <path>), then retry.',
        'Config used: ' + configPath,
      ].join('\n'),
    };
  }
  if (code === 'ECONNREFUSED') {
    return {
      code: EXIT_BRIDGE,
      message: [
        'Nothing is listening on the configured port, so the bridge has stopped.',
        'bridge.json is still on disk but stale; start the bridge again before retrying.',
        'Config used: ' + configPath,
      ].join('\n'),
    };
  }
  if (code === 'TimeoutError' || code === 'ABORT_ERR' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return {
      code: EXIT_BRIDGE,
      message: [
        'The bridge did not answer before the timeout.',
        'Bridge requests are synchronous, so a slow build or test action can exceed it.',
        'Raise it with --timeout <ms> if the action is expected to be slow.',
      ].join('\n'),
    };
  }
  if (body) {
    return { code: EXIT_ACTION, message: body };
  }
  return { code: EXIT_ACTION, message: String(code || 'request failed') };
}

async function callAction(configPath, config, action, input, timeoutMs, { dryRun = false } = {}) {
  const endpoint = 'http://127.0.0.1:' + config.port + '/tool';
  const body = JSON.stringify({ action, input: input || {} });
  const headers = { 'content-type': 'application/json', 'x-modmind-token': config.token };
  if (dryRun) {
    return {
      dryRun: true,
      endpoint,
      headers: { ...headers, 'x-modmind-token': '<redacted>' },
      body: JSON.parse(body),
    };
  }
  let response;
  try {
    response = await fetch(endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    // undici reports a refused connection as `TypeError: fetch failed` and puts the
    // real code on `cause`, so look there first or every connection error looks alike.
    const cause = error && error.cause;
    const code = (cause && cause.code) || (error && (error.code || error.name));
    const described = describeFailure({ code, configPath });
    throw new BridgeCallError(described.message, described.code);
  }
  const text = await response.text();
  if (!response.ok) {
    const described = describeFailure({ status: response.status, body: text.trim(), configPath });
    throw new BridgeCallError(described.message, described.code);
  }
  if (!text.trim()) {
    throw new BridgeCallError('The bridge returned an empty 2xx response.', EXIT_ACTION);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text.trim(); // a 2xx body that is not JSON is still a valid result
  }
}

function parseArgv(argv) {
  const options = { command: null, action: null, input: null, inputFile: null, json: false, pretty: true, dryRun: false, config: null, timeout: 300000 };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') { options.json = true; options.pretty = false; continue; }
    if (arg === '--pretty') { options.pretty = true; options.json = false; continue; }
    if (arg === '--dry-run') { options.dryRun = true; continue; }
    if (arg === '--help' || arg === '-h') { positional.unshift('help'); continue; }
    if (arg === '--input' || arg === '--input-file' || arg === '--config' || arg === '--timeout') {
      const value = argv[index + 1];
      if (value === undefined) throw new BridgeConfigError('Missing value for ' + arg);
      index += 1;
      if (arg === '--input') options.input = value;
      else if (arg === '--input-file') options.inputFile = value;
      else if (arg === '--config') options.config = value;
      else { options.timeout = Number(value); if (!Number.isFinite(options.timeout) || options.timeout <= 0) throw new BridgeConfigError('--timeout must be a positive number of milliseconds'); }
      continue;
    }
    if (arg.startsWith('-') && arg !== '-') throw new BridgeConfigError('Unknown option: ' + arg);
    positional.push(arg);
  }
  options.command = positional.shift() || null;
  options.action = positional.shift() || null;
  if (positional.length) throw new BridgeConfigError('Unexpected argument: ' + positional[0]);
  return options;
}

function readInput(options) {
  let raw = options.input;
  if (options.inputFile) {
    const from = options.inputFile === '-' ? 0 : options.inputFile;
    raw = from === 0 ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(from), 'utf8');
  }
  if (raw === null || raw === undefined) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new BridgeConfigError('--input must be a JSON object: ' + (error.message || error));
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BridgeConfigError('--input must be a JSON object');
  }
  return parsed;
}

// Rejecting MCP tool names here is deliberate: modmind_validate_content maps to
// content_validate, so stripping the prefix would silently call the wrong action.
function assertActionName(action) {
  if (!action) throw new BridgeConfigError('Missing <action> (see docs/bridge-contract.md)');
  if (action.startsWith('modmind_')) {
    throw new BridgeConfigError(
      'This adapter takes a bridge action, not an MCP tool name: ' + action + '\n' +
      'The mapping is not a plain prefix strip (modmind_validate_content -> content_validate),' + '\n' +
      'so use the action column of docs/bridge-contract.md.'
    );
  }
  if (!/^[a-z0-9_]+$/.test(action)) throw new BridgeConfigError('Invalid action name: ' + action);
}

function printResult(value, options) {
  const text = options.pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  process.stdout.write(text + '\n');
}

async function main(argv) {
  let options;
  try {
    options = parseArgv(argv);
  } catch (error) {
    process.stderr.write(String(error.message || error) + '\n' + '\n' + USAGE + '\n');
    return EXIT_USAGE;
  }
  if (!options.command || options.command === 'help') {
    process.stdout.write(USAGE + '\n');
    return options.command ? EXIT_OK : EXIT_USAGE;
  }

  // Validate usage before touching the filesystem: a bad command or action name is a
  // usage error, not a bridge error, and must not depend on a bridge being present.
  if (!KNOWN_COMMANDS.includes(options.command)) {
    process.stderr.write('Unknown command: ' + options.command + '\n\n' + USAGE + '\n');
    return EXIT_USAGE;
  }
  if (options.command === 'call') {
    try {
      assertActionName(options.action);
    } catch (error) {
      process.stderr.write(String(error.message || error) + '\n');
      return EXIT_USAGE;
    }
  }

  const configPath = resolveConfigPath(options.config);
  let config;
  try {
    config = loadBridgeConfig(configPath);
  } catch (error) {
    process.stderr.write(String(error.message || error) + '\n');
    return EXIT_BRIDGE;
  }

  try {
    if (options.command === 'doctor') {
      // Never print the token: docs/external-bridge-integration.zh-CN.md section 8.
      const report = {
        config: configPath,
        port: config.port,
        version: config.version || null,
        token: 'present (' + config.token.length + ' chars, redacted)',
      };
      const probed = await callAction(configPath, config, 'mcp_probe', {}, options.timeout);
      report.probe = probed;
      report.ok = true;
      printResult(report, options);
      return EXIT_OK;
    }
    if (options.command === 'probe') {
      const result = await callAction(configPath, config, 'mcp_probe', {}, options.timeout, { dryRun: options.dryRun });
      printResult(result, options);
      return EXIT_OK;
    }
    if (options.command === 'call') {
      assertActionName(options.action);
      const input = readInput(options);
      const result = await callAction(configPath, config, options.action, input, options.timeout, { dryRun: options.dryRun });
      printResult(result, options);
      return EXIT_OK;
    }
    process.stderr.write('Unknown command: ' + options.command + '\n' + '\n' + USAGE + '\n');
    return EXIT_USAGE;
  } catch (error) {
    process.stderr.write(String(error.message || error) + '\n');
    return error instanceof BridgeCallError ? error.exitCode : EXIT_USAGE;
  }
}


main(process.argv.slice(2)).then((code) => { process.exitCode = code; });