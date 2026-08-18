# ModMind MCP Server

This directory is the publishable MCP protocol layer extracted from ModMind. It
implements a local stdio server using JSON-RPC MCP methods and forwards tool calls
to an already-running ModMind bridge over loopback HTTP.

The initial snapshot tracks the ModMind desktop line at `1.3.4`; the package version
(`0.1.0`) is independent and should be bumped when the public bridge contract changes.

The server deliberately contains no Electron code, provider credentials, project
data, logs, bundled Minecraft binaries, or third-party runtime dependencies. It is
not a standalone Minecraft automation backend: a compatible bridge must implement
the action contract in [`docs/bridge-contract.md`](docs/bridge-contract.md).

## Run locally

Node.js 18.18 or newer is required.

```powershell
npm test
$env:MODMIND_BRIDGE_CONFIG = "C:\path\to\project\.modmind\external-agents\bridge.json"
node .\src\mcp-server.mjs
```

MCP clients start the process and communicate through newline-delimited JSON on
stdin/stdout. Do not write logs to stdout; stdout is the protocol channel.

## Client configuration

Copy [`examples/mcp-config.json`](examples/mcp-config.json), replace both paths,
and import it into a client that supports local stdio MCP servers. The desktop
application normally creates `bridge.json` and the per-project configuration
automatically. `MODMIND_BRIDGE_CONFIG` is optional when `bridge.json` is next to
`mcp-server.mjs`.

For the ModMind desktop host startup command, project selection, lifecycle, action
mapping, and compatibility requirements, see
[`docs/external-bridge-integration.zh-CN.md`](docs/external-bridge-integration.zh-CN.md).

## Security model

The bridge binds to `127.0.0.1` and requires a random per-session token in the
`x-modmind-token` header. Treat `bridge.json` as a secret, remove it when the
session ends, and never expose the bridge port outside the local machine. The MCP
server does not decide whether a write/build action is allowed; that policy belongs
to the host application and its review adapter.

## Current status

The source mirrors the current ModMind tool names and action mapping. The public
action contract is intentionally versioned separately from the desktop app. Before
publishing a release, run the preparation checklist in
[`docs/open-source-preparation.zh-CN.md`](docs/open-source-preparation.zh-CN.md).
