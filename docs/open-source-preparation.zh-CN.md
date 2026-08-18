# MCP 开源准备清单

这个目录是从桌面端抽出的 MCP 协议层副本。当前仓库中的真正业务实现仍在
`src/main/externalAgents.ts` 和 `src/main/index.ts`，所以发布前要把“协议层”和
“ModMind 宿主适配层”分开维护。

## 已整理进副本

- `src/mcp-server.mjs`：stdio JSON-RPC MCP Server，支持 `initialize`、`tools/list`、`tools/call`。
- `docs/bridge-contract.md`：loopback HTTP 桥接、认证、生命周期和动作契约。
- `examples/bridge.json`：开发用配置形状，不能直接用于生产。
- `examples/mcp-config.json`：Codex、Claude Code、Cursor 等本地 stdio 客户端可改写的配置样例。
- `package.json`、`LICENSE`、`README.md`：独立包元数据、许可和运行说明。
- `test/`：协议冒烟测试和 fake bridge，不依赖 Electron、网络或第三方包。

## 发布前必须完成

1. **代码边界**：确认副本不包含 `node_modules`、`out`、`release`、`log`、真实项目目录、诊断压缩包、账号配置、API key、cookie、设备凭据或用户上传附件。
2. **许可证**：逐项核对 Codex、Claude Code、Gemini、Qwen、OpenCode、Goose 的商标和再分发条款；MCP 包只分发自己的代码，不捆绑这些 CLI。
3. **接口版本**：给 `bridge.json` 和 action contract 增加版本字段；工具增删、输入 schema 和错误语义要有变更记录。
4. **宿主适配**：为每一个宿主实现 `bridge.json` 生成、随机 token、127.0.0.1 监听、动作路由、写操作审查和停止清理；不能让外部 Agent 直接获得 ModMind 主进程对象。
5. **权限说明**：明确哪些工具会写文件、下载依赖、执行 Gradle、启动 Minecraft/服务器、联网或消耗图像服务额度；默认拒绝未实现或未审查的动作。
6. **输入校验**：宿主必须校验项目路径、相对路径、namespace、端口、输出目录、文件大小、URL 和枚举值，并防止路径穿越及任意命令执行。
7. **隐私与日志**：stdout 只能输出 MCP JSON；日志写 stderr 或宿主日志目录；结果中禁止返回 token、密钥、cookie、完整环境变量和私有下载链接。
8. **跨平台**：在 Windows、macOS、Linux 各验证 Node 路径、cwd、配置路径、进程终止和 app 关闭清理；Windows 不能依赖 PowerShell 的交互窗口行为。
9. **客户端矩阵**：至少完成一个 Codex CLI、Claude Code、一个独立 CLI（Gemini/OpenCode/Qwen/Goose）和一个 IDE（Cursor/VS Code/Cline 等）的真实 PoC；不要把“支持 MCP”当成“已适配”。
10. **兼容性测试**：每个客户端都要通过 `initialize`、`tools/list`、只读工具、一个写工具、错误返回、取消和宿主重启测试。
11. **供应链**：为 npm 包设置 2FA、锁定发布工作流、生成 provenance/SBOM，并在 CI 中运行 `npm test`、静态扫描和 secret scan。
12. **文档**：提供安装、配置、权限模型、数据流、故障排查、版本兼容矩阵、贡献指南、行为准则和安全漏洞披露入口。

## 当前仍需从桌面端抽离的部分

- `ModMindBridge` 的 HTTP Server、token 生命周期和动作路由。
- `ExternalAgentBridgeHandlers` 的宿主接口及所有 Electron IPC 调用。
- AI Review Agent 的放行策略、取消/恢复、快照和任务状态持久化。
- 项目/Loader/Modrinth/CurseForge/Blockbench/Image Studio 等具体服务实现。
- Codex/Claude/其他 CLI 的启动参数、session、输出解析和安装检测。

这些内容不应复制进 MCP npm 包；它们应位于 ModMind 桌面端或独立的 host adapter 包中。

## 建议的首次发布范围

先发布“stdio MCP + bridge contract + fake bridge 测试 + Codex/Claude 配置样例”。
把 modpack、服务器、Blockbench 和图像工具标记为可选能力，等各自的宿主审查、
权限和跨平台测试完成后再宣称稳定支持。
