# ModMind Bridge Contract

The MCP process is a transport adapter. A host application starts a local HTTP
bridge and writes a JSON file with this shape:

The first public snapshot is aligned with ModMind desktop `1.3.4`. Treat the
contract as experimental until the package has a separately versioned schema.

```json
{
  "port": 41234,
  "token": "random-per-session-secret",
  "version": "1.3.4"
}
```

The MCP process sends only `POST http://127.0.0.1:<port>/tool` requests with:

```http
Content-Type: application/json
x-modmind-token: <token>
```

```json
{
  "action": "project_info",
  "input": {}
}
```

A successful bridge returns a JSON value and an HTTP 2xx status. A rejected or
failed action returns a non-2xx status and a short text error. The bridge should
not return credentials, cookies, provider API keys, or raw authentication tokens
in tool results.

## Lifecycle

1. Create a fresh random token and bind the HTTP server to `127.0.0.1` only.
2. Write `bridge.json` before starting the MCP process.
3. Start `src/mcp-server.mjs` through the client's stdio MCP configuration.
4. Stop the MCP process and HTTP server together; delete `bridge.json` during cleanup.
5. Invalidate the token on cancellation, project switch, app shutdown, or crash recovery.

## Action families

The current server advertises these action families:

| Family | Actions | Host implementation |
| --- | --- | --- |
| Project | `project_info`, `rename_project`, `set_intent`, `apply_edits`, `update_todo` | Required for a useful base integration |
| Code and build | `mappings_search`, `mappings_class`, `dependency_search`, `dependency_install`, `content_validate`, `test_matrix`, `release_preflight`, `build_project`, `test_minecraft`, `runtime_state` | Java/Bedrock/NetEase adapters vary |
| Modpack | `modpack_plan`, `modpack_apply_plan`, `mcmod_search`, `mcmod_files`, `modpack_write_ftb_quest`, `modpack_write_patchouli_book`, `modpack_apply_keybinds` | Optional; expose only when the host supports the operation |
| Server | `modpack_build_server`, `modpack_verify_server_join`, `modpack_apply_optimization_profile`, `modpack_run_server_scenario` | Optional and platform-sensitive |
| Design | `blockbench_actions` | Optional; requires the embedded Blockbench bridge |
| Image | `image_generate`, `image_perfect_pixel`, `image_remove_background`, `image_project_assets`, `image_read_project_asset` | Optional; credentials stay in the host |

The MCP layer keeps optional actions visible for compatibility. A host that does
not implement one must return a clear `unavailable` error rather than silently
performing a different action.

## Review and permissions

The current desktop host reviews destructive or externally connected actions before
dispatch. A replacement host must retain equivalent policy checks for at least:

`rename_project`, `apply_edits`, `dependency_install`, `test_matrix`,
`build_project`, `test_minecraft`, all modpack writes/builds, `blockbench_actions`,
and image generation/processing.

The MCP annotations are hints for clients, not an authorization boundary.
