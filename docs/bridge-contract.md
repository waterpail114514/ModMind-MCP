# ModMind Bridge Contract

The MCP process is a transport adapter. A host application starts a local HTTP
bridge and writes a JSON file with this shape:

The `0.2` contract is aligned with the ModMind desktop `1.4.4` development line.

```json
{
  "port": 41234,
  "token": "random-per-session-secret",
  "version": "1.4.4",
  "sourceFingerprint": "sha256:235b5b247370dc5069a627962c848fb0d80f557114a51f51ebf5610db303f504"
}
```

`sourceFingerprint` is a public, non-secret provenance marker. It is not an
authentication value and must not be used for access control.

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
| Project | `project_info`, `project_files`, `rename_project`, `set_intent`, `apply_edits`, `update_todo` | Required for a useful base integration |
| Code and build | `mappings_search`, `mappings_class`, `dependency_search`, `dependency_install`, `maven_dependency_install`, `content_validate`, `test_matrix`, `release_preflight`, `build_project`, `test_minecraft`, `runtime_state` | Java/Bedrock/NetEase adapters vary |
| Add-on | `addon_relationships`, `addon_prepare`, `addon_import`, `addon_link_project` | Optional; add-on targets with verified JARs and license constraints |
| Modpack | `modpack_plan`, `modpack_apply_plan`, `modpack_migration_targets`, `modpack_migration_preview`, `modpack_migration_apply`, `modpack_migration_history`, `modpack_migration_undo`, `modpack_download_content`, `mcmod_search`, `mcmod_files`, `modpack_write_ftb_quest`, `modpack_write_patchouli_book`, `modpack_apply_keybinds` | Optional; expose only when the host supports the operation |
| Server | `modpack_build_server`, `modpack_verify_server_join`, `modpack_apply_optimization_profile`, `modpack_run_server_scenario` | Optional and platform-sensitive |
| Design | `blockbench_project_state`, `blockbench_validate`, `blockbench_capture_views`, `blockbench_actions`, `blockbench_history`, `blockbench_checkpoint`, `blockbench_restore_history`, Asset Intent/refinement, `asset_compile_advanced`, `asset_preview_advanced`, `asset_apply_advanced`, `asset_compile_reference`, `asset_preview_reference`, `asset_apply_reference`, `asset_visual_review` | Optional; requires the embedded Blockbench bridge. Writes enforce revisions and transactional rollback. |
| Image | `image_generate`, `image_perfect_pixel`, `image_remove_background`, `image_project_assets`, `image_read_project_asset` | Optional; credentials stay in the host |
| App settings | `scan_java_homes`, `probe_java_home`, `get_app_settings`, `set_app_setting` | Optional; `set_app_setting` is reviewed like other state-changing actions |

The MCP layer keeps optional actions visible for compatibility. A host that does
not implement one must return a clear `unavailable` error rather than silently
performing a different action.

## Review and permissions

The current desktop host reviews destructive or externally connected actions before
dispatch. A replacement host must retain equivalent policy checks for at least:

`rename_project`, `apply_edits`, `dependency_install`, `maven_dependency_install`,
`addon_prepare`, `addon_import`, `addon_link_project`, `test_matrix`,
`build_project`, `test_minecraft`, all modpack writes/builds/migrations, `blockbench_actions`,
`blockbench_restore_history`, all `asset_apply_*` actions, image generation/processing,
and `set_app_setting`.

The MCP annotations are hints for clients, not an authorization boundary.
