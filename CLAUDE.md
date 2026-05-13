# openclaw-mesh

openclaw 插件，解决同一 Tailscale tailnet 内多个 openclaw gateway 之间的 **agent 互相发消息** 问题。

## 背景与目标

openclaw gateway 开启 `gateway.tailscale.mode = serve` 后，本机 gateway 以 HTTPS 形式暴露到 Tailscale tailnet。

同一组织里的多台机器（每台各自跑一个 openclaw gateway）可以互相发现、互相发消息，实现 agent 组织化协作。

核心流程：
```
tailscale status → 发现在线节点 → 握手取 token → gateway call 发消息
```

---

## 开发分阶段计划

### Phase 1 — Discovery（摸清谁在线）
- 调用本机 `tailscale status --json` 解析在线节点
- 对每个节点的 `{ip}:{port}` 探测 `GET /health`，返回 200 则确认为 openclaw 节点
- 缓存结果，按 `discovery.interval` 定时刷新

### Phase 2 — 手动 token + mesh_send（跑通通信）
- 在 config 里手动配置已知节点的 url + token
- 实现 `mesh_send(target, agentId, message)` tool
- 底层调用 `openclaw gateway call` 的 HTTP 等价逻辑（POST 到对方 gateway 的 agent 端点）

### Phase 3 — 共享密钥握手（自动化 token 交换）
- 各节点在 config 里配同一个 `mesh.sharedSecret`（通过环境变量注入，不写死）
- A 调 B 的 `POST /mesh/hello`，body 带 `{ nodeId, timestamp, hmac }`
  - `hmac = HMAC-SHA256(sharedSecret, nodeId + ":" + timestamp)`
- B 验证签名和时间窗（±5 分钟防重放），返回一个限时 session token
- A 缓存该 token，用于后续 gateway call
- token 过期前自动续签

### Phase 4 — mesh_broadcast + 路由表
- `mesh_broadcast(message)` 向所有在线节点的指定 agentId 广播
- 路由表持久化到 `~/.openclaw/mesh-peers.json`，支持手动覆盖

---

## 目录结构

```
openclaw-mesh/
├── CLAUDE.md                  ← 本文件
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── openclaw.plugin.json       ← 插件声明（id、configSchema、contracts）
├── index.ts                   ← 插件入口，register() 在这里
└── src/
    ├── types/
    │   └── index.ts           ← 所有共享类型（Peer、MeshConfig、HandshakeResult 等）
    ├── discovery/
    │   └── index.ts           ← tailscale status 解析 + /health 探测
    ├── store/
    │   └── index.ts           ← 内存 peer 注册表，增删改查
    ├── handshake/
    │   └── index.ts           ← HMAC 生成/验证，session token 管理
    ├── http/
    │   └── index.ts           ← /mesh/hello 端点注册（供对方握手用）
    ├── router/
    │   └── index.ts           ← 消息路由，target 解析，调 gateway call HTTP
    └── tools/
        └── index.ts           ← registerMeshTools()，注册 mesh_send / mesh_peers
```

入口 `index.ts` 只做组装，不含业务逻辑：

```ts
export default {
  id: "openclaw-mesh",
  configSchema: meshConfigSchema,
  register(api: OpenClawPluginApi) {
    const store   = createPeerStore();
    const router  = createRouter(store, api.runtime);
    startDiscovery(store, api.config, api.log);
    registerMeshHttpRoutes(api, store);
    registerMeshTools(api, router);
  },
};
```

---

## 配置 schema（openclaw.json 里的 mesh 节）

```jsonc
{
  "plugins": {
    "entries": {
      "openclaw-mesh": {
        "enabled": true,
        "config": {
          "sharedSecret": "ref:env:MESH_SECRET",   // 组织内所有节点用同一个
          "port": 18789,                            // 对方 gateway 默认端口
          "discovery": {
            "interval": "60s",
            "probe": true                           // 是否主动探测 /health
          },
          "peers": {                                // Phase 2 手动配，Phase 3 可省略
            "baijing": {
              "url": "http://100.64.0.10:18789/",
              "token": "ref:env:PEER_BAIJING_TOKEN"
            }
          }
        }
      }
    }
  }
}
```

---

## Agent Tool 接口

插件向 agent 暴露两个工具：

### `mesh_peers`
列出当前在线的 openclaw 节点。

输入：无
输出：
```json
[
  { "hostname": "baijing", "ip": "100.64.0.10", "url": "http://100.64.0.10:18789/", "online": true, "agents": ["main", "402950"] },
  { "hostname": "openclaw-test-2", "ip": "100.64.0.7", "url": "http://100.64.0.7:18789/", "online": true, "agents": ["main"] }
]
```

### `mesh_send`
向指定节点的 agent 发消息。

输入：
```json
{
  "target": "baijing",          // hostname 或 IP
  "agentId": "main",
  "message": "你好，请帮我查一下...",
  "sessionKey": "agent:main:张三:10042",   // 可选，指定对方 session
  "timeoutMs": 30000
}
```
输出：对方 agent 的回复文本，或超时错误。

---

## 开发规范

### TypeScript
- `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`
- 所有内部引用用 `.js` 后缀（NodeNext 要求）
- 不用 `any`，类型从 `src/types/index.ts` 统一导出
- 不写注释，用好函数名和类型名替代
- 错误用 `Result<T, E>` 模式返回，不在内部随意 throw

### openclaw 插件规范
- `openclaw.plugin.json` 里必须声明 `contracts.tools`，否则工具注册会被 gateway 拦截（doctor 里 `plugin must declare contracts.tools` 就是这个错）
- HTTP 路由注册必须带 `auth` 字段，合法值为 `"gateway"` 或 `"plugin"`（SDK 不支持 `"none"`）；`/mesh/hello` 和 `/mesh/send` 用 `auth: "plugin"`，端点内部自行验签/校验 session token
- 配置引用用 `ref:env:XXX` 形式，不硬编码 token / secret
- `register()` 不能是 async，需要的 async 初始化放进 `startDiscovery()` 等后台函数

### 构建
```bash
npm run build        # tsc -p tsconfig.build.json → dist/
npm run dev          # tsc --watch
npm run deploy       # openclaw plugins install .
```
构建产物在 `dist/`，`tsconfig.build.json` 的 `outDir` 指向它。

### 推送
每次提交后必须同时推两个 remote：
```bash
git push origin main   # GitLab（内网）
git push github main   # GitHub（公开）
```

### 测试节点
当前 tailnet 在线节点（开发期参考）：
```
100.64.0.10  baijing          macOS  本机
100.64.0.8   1c371da7583c     linux  在线
100.64.0.6   ai-driven-org    linux  在线
100.64.0.7   openclaw-test-2  linux  在线
```
gateway call 参考命令：
```bash
openclaw gateway call \
  --url http://100.64.0.7:18789/ \
  --token "<token>" \
  --timeout 300000 \
  --expect-final \
  --json \
  agent \
  --params '{"agentId":"main","message":"hello"}'
```

---

## 关键依赖

```json
{
  "peerDependencies": { "openclaw": ">=2026.5.0" },
  "devDependencies": { "openclaw": "latest", "typescript": "^5.9.3" }
}
```

不引入额外 HTTP 客户端，用 Node 原生 `fetch`（Node 25 已内置）。  
不引入额外加密库，用 Node 原生 `crypto.createHmac`。

---

## 注意事项

- `tailscale status --json` 的路径在 macOS 上是 `/Applications/Tailscale.app/Contents/MacOS/Tailscale status --json`，Linux 上是 `tailscale status --json`，discovery 模块需要做平台判断
- 握手时间窗校验用 UTC timestamp（秒），±300s 内有效，防重放
- `mesh_send` 超时默认 30s，调用方可覆盖；超时后必须返回明确错误，不能 hang
- Phase 1、2 可以合并开发，先把 `peers` 手动配上让工具跑起来，再接 discovery
