# MCP Source Inventory

This inventory records where the current desktop implementation lives and what
belongs in the standalone public package.

| Current repository location | Role | Public package disposition |
| --- | --- | --- |
| `src/main/externalAgents.ts` | MCP source string, loopback `ModMindBridge`, handler interface, CLI launch/session parsing | Keep the protocol behavior in `src/mcp-server.mjs`; keep the Electron bridge and CLI orchestration in the host repository |
| `src/main/index.ts` | Creates the host handler implementations and connects them to Electron IPC/services | Host-only; do not publish as part of the MCP npm package |
| `src/main/aiReviewer.ts` | Optional review-agent policy for risky actions | Host adapter; document the permission boundary, do not embed credentials or provider code |
| `src/main/*Service.ts` | Minecraft, Modrinth, server, image, Blockbench, and release implementations | Host capabilities; expose only through the bridge contract |
| `src/shared/types.ts` | Desktop IPC and project types | Host-only unless a separately versioned public schema is extracted |
| `resources/codex-skills/*` | Optional workflow guidance copied into a project session | Publish separately or omit; it is not required to implement MCP transport |
| `src/preload/index.ts`, `src/renderer/*` | Electron UI and IPC surface | Never include in the standalone MCP package |
| `node_modules`, `out`, `release`, `log`, `review-pending-cleanup-*` | Local/install/build artifacts and user material | Never publish |

The standalone package is intentionally dependency-free and cannot operate without
a host bridge. This is a feature: it prevents the public package from accidentally
coupling to Electron internals, local credentials, or bundled proprietary/user data.
