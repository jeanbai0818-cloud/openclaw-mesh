# OpenClaw Plugin Development — Soul

## 入口与结构

```ts
// index.ts
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "my-plugin",
  name: "My Plugin",
  register(api) {
    // register() 必须同步；async 初始化放后台函数
  },
});
```

- 渠道插件用 `defineChannelPluginEntry`，其余用 `definePluginEntry`
- 始终从细粒度子路径导入：`openclaw/plugin-sdk/plugin-entry`，不用根 barrel
- 内部模块用本地 `./api.ts` / `./runtime-api.ts`，不通过 SDK 自导入

---

## 清单（openclaw.plugin.json）

每个插件必须有清单，哪怕无配置：

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "contracts": {
    "tools": ["tool_name"]
  },
  "activation": { "onStartup": true },
  "configSchema": { "type": "object", "additionalProperties": false }
}
```

关键规则：
- `contracts.tools` 必须列出所有 `api.registerTool()` 注册的工具，否则 gateway 拦截
- 可选工具在 `toolMetadata.<name>.optional: true` 中声明
- HTTP 路由带 `auth` 字段；握手/公开端点用 `auth: "none"`
- 配置敏感值用 `ref:env:VAR_NAME`，不硬编码

---

## 工具注册

```ts
api.registerTool({
  name: "my_tool",
  description: "...",
  parameters: Type.Object({ input: Type.String() }),
  async execute(_id, params) {
    return { content: [{ type: "text", text: params.input }] };
  },
});

// 可选工具（用户需显式开启）
api.registerTool({ name: "opt_tool", ... }, { optional: true });
```

---

## 主要注册 API

| 方法 | 用途 |
|------|------|
| `api.registerTool(tool, opts?)` | 智能体工具 |
| `api.registerHttpRoute(params)` | Gateway HTTP 端点 |
| `api.registerService(service)` | 后台服务 |
| `api.registerHook(events, handler)` | 事件钩子 |
| `api.registerCommand(def)` | 自定义命令 |
| `api.registerCli(registrar, opts?)` | CLI 子命令 |
| `api.registerProvider(...)` | LLM 提供商 |
| `api.registerChannel(...)` | 消息渠道 |

分组命名空间（新代码优先用）：
- `api.session.state.registerSessionExtension(...)`
- `api.session.workflow.enqueueNextTurnInjection(...)`
- `api.lifecycle.registerRuntimeLifecycle(...)`
- `api.agent.events.registerAgentEventSubscription(...)`

---

## 钩子决策语义

- `before_tool_call` → `{ block: true }` 终止；`{ block: false }` 等同于无决策
- `before_install` → 同上
- `message_sending` → `{ cancel: true }` 终止；`{ cancel: false }` 等同于无决策
- `reply_dispatch` → `{ handled: true }` 终止后续处理器

---

## TypeScript 规范

- `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`
- 内部引用加 `.js` 后缀（NodeNext 要求）
- 不用 `any`，类型从统一的 `src/types/index.ts` 导出
- 不写注释，用好函数名和类型名替代
- 错误用 `Result<T, E>` 返回，不随意 `throw`

---

## 构建与发布

```bash
npm run build        # tsc → dist/
openclaw plugins install .   # 本地安装测试
openclaw plugins inspect <id> --runtime --json   # 验证注册
```

外部发布：
```bash
clawhub package publish your-org/your-plugin
openclaw plugins install clawhub:@myorg/my-plugin
```

---

## 常见陷阱

- `register()` 不能是 async
- 工具名不得与核心工具冲突（冲突项会被跳过，不报错）
- 插件专属 Gateway RPC 方法必须用插件前缀；`config.*` / `exec.approvals.*` 等是保留命名空间
- 可选工具未加入用户 `tools.allow` 前插件运行时不会被加载
- `setup.cliBackends` 允许设备发现在冷启动时识别后端，不依赖运行时加载
