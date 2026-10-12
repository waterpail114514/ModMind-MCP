# ModMind MCP Server

The current source in this repository is licensed under the GNU Affero General
Public License v3.0 only (`AGPL-3.0-only`). Releases published before this
change retain their original license. See [LICENSE](LICENSE) for the license
terms and the complete GNU text.

This directory is the publishable MCP protocol layer extracted from ModMind. It
implements a local stdio server using JSON-RPC MCP methods and forwards tool calls
to an already-running ModMind bridge over loopback HTTP.

The current snapshot tracks the ModMind desktop `1.4.4` development line. The
package version (`0.2.0`) is independent from the desktop version.

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

## Command-line adapter

This copy also ships a command-line adapter, so the same bridge can be driven from
a shell, a script, or CI without an MCP client:

```powershell
$env:MODMIND_BRIDGE_CONFIG = "C:\path\to\project\.modmind\external-agents\bridge.json"
node .\src\cli.mjs doctor                       # resolve and validate the config, then probe
node .\src\cli.mjs call project_info --json     # run one action
node .\src\cli.mjs call project_info --dry-run  # print the request instead of sending it
```

It takes **bridge actions**, not MCP tool names: the mapping is not a plain prefix
strip (`modmind_validate_content` maps to `content_validate`), so the adapter does not
guess. See the action families in [`docs/bridge-contract.md`](docs/bridge-contract.md).

Exit codes: `0` success, `2` usage error, `3` bridge unavailable (missing
`bridge.json`, rejected token, or nothing listening), `4` action failed. With `--json`,
stdout carries only JSON and every diagnostic goes to stderr; the token is never
printed. Like the MCP server, this adapter is transport only — approval and review
policy still belong to the host application.

## Security model

The bridge binds to `127.0.0.1` and requires a random per-session token in the
`x-modmind-token` header. Treat `bridge.json` as a secret, remove it when the
session ends, and never expose the bridge port outside the local machine. The MCP
server does not decide whether a write/build action is allowed; that policy belongs
to the host application and its review adapter.

Installed plugin tools are queried from the desktop bridge on every `tools/list`, so
install, enable, disable, and reload changes are visible without restarting this
process. The `modmind_plugins_*` tools provide the plugin authoring workflow. A
plugin backend is fully trusted Node code after the desktop user confirms install;
its manifest permissions describe host-bridge conveniences, not an OS sandbox.

## Current status

The source mirrors the current ModMind tool names and action mapping. The public
action contract is intentionally versioned separately from the desktop app. Before
publishing a release, run the preparation checklist in
[`docs/open-source-preparation.zh-CN.md`](docs/open-source-preparation.zh-CN.md).

The design tools include exact Cube/Mesh topology editing, face UV and texture
painting, automatic Mesh UV atlases, armatures, vertex weights, locators, IK,
animation tracks, reference-image silhouette extrusion, visual scoring, bounded
A/B/C candidate optimization, and 20-entry checkpoint history. Preview responses
return PNG captures as MCP image content while removing base64 payloads from their
text copy.
