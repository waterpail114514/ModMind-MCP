# ModMind 外部 Bridge 集成规范

本文档是给外部 Agent、IDE 插件和自动化工具作者看的公开接入契约。
它描述的是 ModMind 桌面端提供的本地 Bridge，不要求开发者把 ModMind 的 Electron
源码嵌入自己的工具，也不要求用户开放公网端口。

## 1. 启动入口

打包版 ModMind：

```powershell
ModMind.exe --mcp-bridge --project "C:\Projects\my-mod"
```

开发环境：

```powershell
npm.cmd run dev -- --mcp-bridge --project "C:\Projects\my-mod"
```

如果 ModMind 已经在运行，第二次执行上述命令会通过 Electron 的单实例消息把
启动请求转发给现有实例，不会再创建第二个窗口。

停止 Bridge：

```powershell
ModMind.exe --mcp-bridge-stop
```

停止命令也会转发给已运行的 ModMind 实例。Bridge 只绑定 `127.0.0.1`，不接受
局域网或公网连接。

## 2. 项目选择

`--project` 必须指向包含以下任一项目清单的目录：

- `modmind.project.json`
- 旧版 `modtool.project.json`

启动 Bridge 时，ModMind 会把该目录设为当前项目，并把所有工具调用限制在这个项目
上下文中。项目切换时，旧项目 Bridge 会停止；外部工具必须重新读取新项目生成的配置。

不传 `--project` 只适用于 ModMind 已经有当前项目的场景，首次启动时应始终显式传入。

## 3. 生成的文件

启动成功后，ModMind 在项目的 `.modmind/external-agents/` 目录（旧项目可能是
`.modtool/external-agents/`）生成：

| 文件 | 用途 | 是否敏感 |
| --- | --- | --- |
| `bridge.json` | Bridge 端口、token 和版本 | 是，不能提交仓库 |
| `mcp-bridge.json` | 机器可读的 Bridge 状态和路径索引 | 包含本机路径，不建议提交 |
| `mcp-config.json` | 使用 ModMind 内置 MCP Server 的客户端配置 | 包含本机路径 |
| `modmind-mcp-server.mjs` | stdio MCP 转发器 | 否 |
| `agent-context.md` | 当前项目和工具链上下文 | 可能包含项目路径 |

外部开发者若使用公开副本中的 Node MCP Server，建议自行生成如下配置，避免依赖
Electron 运行时：

```json
{
  "mcpServers": {
    "modmind": {
      "command": "node",
      "args": ["C:/path/to/modmind-mcp-open-source/src/mcp-server.mjs"],
      "env": {
        "MODMIND_BRIDGE_CONFIG": "C:/Projects/my-mod/.modmind/external-agents/bridge.json"
      }
    }
  }
}
```

## 4. `bridge.json` 格式

当前稳定字段如下；对应 schema 见 [`examples/bridge.schema.json`](../examples/bridge.schema.json)。

```json
{
  "port": 41234,
  "token": "random-per-session-secret",
  "version": "1.3.4"
}
```

字段说明：

- `port`：ModMind 在 `127.0.0.1` 上随机分配的 TCP 端口。
- `token`：由 ModMind 为每次 Bridge 会话生成的随机 token，当前使用 UUID 强度的随机值。
- `version`：ModMind 桌面端版本，用于兼容性诊断。

外部工具不得猜测端口或复用旧 token，必须在每次启动后重新读取 `bridge.json`。

## 5. HTTP Bridge 契约

MCP Server 向以下地址发送请求：

```text
POST http://127.0.0.1:<port>/tool
```

请求头：

```http
Content-Type: application/json
x-modmind-token: <bridge.json.token>
```

请求体：

```json
{
  "action": "project_info",
  "input": {}
}
```

成功响应为 HTTP `200` 和任意 JSON 值：

```json
{
  "name": "Example Mod",
  "loader": "fabric",
  "minecraftVersion": "1.21.1"
}
```

失败响应为 HTTP `400` 和纯文本错误；请求方法、路径或 token 不匹配时返回 HTTP `404`。
外部工具应把 `400` 作为工具失败展示给 Agent，不要静默重试写操作。

## 6. MCP 生命周期

外部工具的标准流程：

1. 启动或请求 ModMind 执行 `--mcp-bridge --project <path>`。
2. 等待 `.modmind/external-agents/bridge.json` 和 `mcp-bridge.json` 出现。
3. 读取新的 `bridge.json`，启动 stdio MCP Server。
4. 发送 MCP `initialize`，确认返回 `serverInfo.name = modmind`。
5. 发送 `tools/list`，以返回的 schema 为准，不要硬编码工具版本。
6. 任务结束或用户取消时执行 `--mcp-bridge-stop`，并关闭 MCP 子进程。

ModMind 在以下情况停止 Bridge、关闭 HTTP Server 并删除 `bridge.json`：

- 收到 `--mcp-bridge-stop`；
- 应用退出；
- 当前项目切换；
- Bridge 启动失败后的清理流程。

当前版本没有远程持久 token；Bridge 会话结束后旧 token 不应继续使用。

## 7. 工具与 action 映射

MCP 工具名映射到 HTTP `action` 的规则如下：

| MCP 工具 | HTTP action | 当前公开 Bridge |
| --- | --- | --- |
| `modmind_project_info` | `project_info` | 支持 |
| `modmind_rename_project` | `rename_project` | 支持 |
| `modmind_set_intent` | `set_intent` | 支持 |
| `modmind_apply_edits` | `apply_edits` | 支持 |
| `modmind_update_todo` | `update_todo` | 支持 |
| `modmind_mapping_search` / `modmind_mapping_class` | `mappings_search` / `mappings_class` | 支持 |
| `modmind_dependency_search` / `modmind_dependency_install` | `dependency_search` / `dependency_install` | 支持 |
| `modmind_validate_content` | `content_validate` | 支持 |
| `modmind_test_matrix` | `test_matrix` | 支持 |
| `modmind_release_preflight` | `release_preflight` | 支持 |
| `modmind_build_project` / `modmind_test_minecraft` | `build_project` / `test_minecraft` | 支持 |
| `modmind_blockbench_actions` | `blockbench_actions` | 支持 |
| `modmind_runtime_state` | `runtime_state` | 支持 |
| `modmind_image_*` | `image_*` | 支持，依赖 Image Studio 配置 |
| `modmind_modpack_*` / `modmind_mcmod_*` | 对应去掉 `modmind_` 的 action | 支持；仅对整合包项目生效，服务器验证还需要本地运行时依赖 |

每个工具的完整输入 schema 以 MCP `tools/list` 为唯一来源。公开 MCP 副本中的
`src/mcp-server.mjs` 保持工具名和 action 映射；Bridge 不接受未列出的 action。

核心输入示例：

```json
{
  "action": "apply_edits",
  "input": {
    "edits": [
      {
        "path": "src/main/resources/example.txt",
        "oldText": "old",
        "newText": "new"
      }
    ]
  }
}
```

## 8. 权限和安全

公开 Bridge 使用本地规则审查以下高风险动作：写文件、重命名、安装依赖、构建、
Minecraft 启动、Blockbench 操作和图像生成/处理。审查失败会返回工具错误。

Bridge 不是沙箱，也不能替代操作系统权限。宿主和外部工具必须：

- 不把 Bridge 绑定到 `0.0.0.0`；
- 不把 `bridge.json`、token 或项目凭据发给 Agent；
- 不把项目绝对路径、环境变量或私有下载 token写进工具结果；
- 对项目相对路径、文件大小、URL、端口和枚举值做输入校验；
- 关闭 MCP 子进程和 Bridge 的整个进程树，而不是只关闭父进程。

## 9. 兼容性约束

外部工具发布前至少验证：

1. `initialize`、`tools/list`、`modmind_project_info`。
2. 一个精确文本编辑和一次构建或内容校验。
3. Bridge 停止后旧 token 失效。
4. 项目切换后旧项目配置不再被使用。
5. Windows、macOS、Linux 的启动和退出清理。

Bridge 的公开 schema 版本是 `1`。新增工具可以向后兼容地追加；修改现有 action 的
输入或错误语义时必须提升 schema 版本并更新兼容矩阵。
