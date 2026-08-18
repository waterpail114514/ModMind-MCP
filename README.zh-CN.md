# ModMind MCP

这是 ModMind 的本地 MCP 接入层，给 Codex、Claude Code、Gemini CLI、Cursor 等支持
stdio MCP 的 Agent 使用。

它本身不负责构建 Minecraft 项目，也不直接持有 Modrinth、图像服务或其他供应商的
账号凭据。它只做两件事：

1. 通过 stdin/stdout 实现标准 MCP JSON-RPC 通信。
2. 把 Agent 发起的工具调用转给正在运行的 ModMind Bridge。

ModMind Bridge 才是项目文件、Gradle、Minecraft 测试实例、整合包、Blockbench 和
图像工具的实际宿主。

## 适合谁

- 想把 ModMind 工具接入其他 Coding Agent 的开发者。
- 想为 ModMind 编写独立宿主适配器的贡献者。
- 想先在没有 Electron 的环境中测试 MCP 协议行为的人。

如果你只想在 ModMind 桌面端使用 MCP，通常不需要手动运行本目录；桌面端会为当前
项目生成 Bridge、token 和 MCP 配置。

## 三分钟启动

环境要求：Node.js 18.18 或更高版本。

先准备一个正在运行的 Bridge 配置。开发时可以参考
[`examples/bridge.json`](examples/bridge.json)：

```json
{
  "port": 41234,
  "token": "replace-with-a-random-per-session-token",
  "version": "0.1.0"
}
```

然后运行测试或启动 MCP Server：

```powershell
npm test
$env:MODMIND_BRIDGE_CONFIG = "C:\path\to\project\.modmind\external-agents\bridge.json"
node .\src\mcp-server.mjs
```

启动后，进程会等待 MCP 客户端通过 stdin 发送请求。不要向 stdout 打印调试信息；
stdout 只允许出现 MCP JSON 响应，调试日志请写 stderr。

## 接入其他 Agent

完整的外部 Bridge 启动和协议说明见
[`docs/external-bridge-integration.zh-CN.md`](docs/external-bridge-integration.zh-CN.md)。
支持的启动入口是 `ModMind.exe --mcp-bridge --project <项目目录>`；停止入口是
`ModMind.exe --mcp-bridge-stop`。

复制 [`examples/mcp-config.json`](examples/mcp-config.json)，修改 MCP Server 路径和
Bridge 配置路径，再导入到支持本地 stdio MCP 的客户端：

```json
{
  "mcpServers": {
    "modmind": {
      "command": "node",
      "args": ["C:/path/to/modmind-mcp-open-source/src/mcp-server.mjs"],
      "env": {
        "MODMIND_BRIDGE_CONFIG": "C:/path/to/active-project/.modmind/external-agents/bridge.json"
      }
    }
  }
}
```

Windows 路径建议使用正斜杠，或在 JSON 中将反斜杠写成 `\\`。

## 能力范围

当前副本暴露 32 个工具，覆盖以下方向：

- 项目元数据、精确文本编辑和任务进度。
- Minecraft mappings、Modrinth 依赖、内容校验、构建和测试矩阵。
- 整合包规划、任务书、Patchouli、按键、服务器和优化配置。
- Blockbench 操作和 Image Studio 图像处理。

工具清单和参数 schema 以 Server 返回的 `tools/list` 为准。宿主没有实现的可选能力，
应返回明确的 unavailable 错误，不能偷偷改用其他动作。

## 它是如何工作的

```text
Coding Agent
    | stdin/stdout: MCP JSON-RPC
    v
mcp-server.mjs
    | POST 127.0.0.1:<port>/tool
    | x-modmind-token
    v
ModMind Bridge
    v
ModMind 项目服务和权限审查
```

完整的 HTTP 请求格式、动作名、生命周期和 review 要求见
[`docs/bridge-contract.md`](docs/bridge-contract.md)。

## 安全边界

Bridge 必须只监听 `127.0.0.1`，并为每个会话生成新的随机 token。

- `bridge.json` 是敏感配置，不能提交到仓库或发给 Agent。
- 项目切换、任务取消、应用退出和异常恢复时必须关闭 Bridge 并使 token 失效。
- 宿主必须审查写文件、安装依赖、执行 Gradle、启动 Minecraft/服务器、联网和图像额度消耗等操作。
- 必须校验项目相对路径、输出目录、URL、端口、枚举值和文件大小，防止路径穿越和任意命令执行。
- 工具结果不能包含 API key、cookie、设备凭据、完整环境变量或私有下载链接。

MCP 工具的 annotations 只是客户端提示，不是权限系统。真正的授权逻辑必须在宿主
Bridge 中实现。

## 作为宿主接入时要补什么

如果你要让另一个应用复用这些工具，需要实现：

1. Bridge 的启动、随机 token、端口绑定和退出清理。
2. `project_info`、`apply_edits`、构建/测试等动作的实际路由。
3. 写操作和联网操作的审批策略。
4. 项目切换、取消、崩溃恢复时的进程树清理。
5. 结果脱敏、错误分类和日志隔离。

Electron 主进程中的实现位置、哪些文件应留在宿主侧，见
[`docs/source-inventory.md`](docs/source-inventory.md)。

## 发布前检查

请按 [`docs/open-source-preparation.zh-CN.md`](docs/open-source-preparation.zh-CN.md)
执行完整检查，重点包括：

- 不发布 `node_modules`、`release`、`out`、日志、诊断包、用户项目和任何密钥。
- 核对第三方 CLI 的商标、许可证和再分发条款；本包不捆绑这些 CLI。
- 在 Windows、macOS、Linux 验证启动、取消、重启和清理。
- 至少验证一个 CLI、一个 IDE 和一次写操作闭环。
- 在 CI 中加入测试、secret scan、SBOM 和 npm 发布保护。

## 目录结构

```text
src/mcp-server.mjs                 stdio MCP Server
docs/bridge-contract.md             Bridge HTTP 契约
docs/source-inventory.md            宿主代码与开源代码边界
docs/open-source-preparation.zh-CN.md  发布准备清单
examples/bridge.json                Bridge 配置形状
examples/mcp-config.json            客户端配置样例
test/mcp-server.test.mjs            fake bridge 协议测试
```

## 版本说明

本副本基于 ModMind 桌面端 `1.3.4`，MCP 包版本为 `0.1.0`。两套版本独立管理；当
Bridge action、输入 schema、错误语义或安全行为发生不兼容变化时，应提升 MCP 包主版本。
