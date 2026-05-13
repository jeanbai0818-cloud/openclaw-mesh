# openclaw-mesh

OpenClaw 插件，解决同一 Tailscale tailnet 内多个 OpenClaw gateway 之间的 **agent 互相发消息** 问题。

## 背景

OpenClaw gateway 开启 `gateway.tailscale.mode = serve` 后，本机 gateway 以 HTTPS 形式暴露到 Tailscale tailnet。同一组织里的多台机器（每台各自跑一个 OpenClaw gateway）可以互相发现、互相发消息，实现 agent 组织化协作。

```
tailscale status → 发现在线节点 → 握手取 token → gateway call 发消息
```

## 功能

### `mesh_peers`

列出当前在线的 OpenClaw 节点。

```json
[
  { "hostname": "baijing", "ip": "100.64.0.10", "url": "http://100.64.0.10:18789/", "online": true },
  { "hostname": "openclaw-test-2", "ip": "100.64.0.7", "url": "http://100.64.0.7:18789/", "online": true }
]
```

### `mesh_send`

向指定节点的 agent 发消息。

```json
{
  "target": "baijing",
  "agentId": "main",
  "message": "你好，请帮我查一下...",
  "timeoutMs": 30000
}
```

## 安装

```bash
openclaw plugins install clawhub:openclaw-mesh
```

## 配置

在 `openclaw.json` 的 `plugins.entries` 中添加：

```jsonc
{
  "openclaw-mesh": {
    "enabled": true,
    "config": {
      "sharedSecret": "ref:env:MESH_SECRET",
      "meshToken": "ref:env:MESH_GATEWAY_TOKEN",
      "port": 18789,
      "allowAgents": ["main"],
      "discovery": {
        "interval": "60s",
        "probe": true
      },
      "peers": {
        "baijing": {
          "url": "http://100.64.0.10:18789/",
          "token": "ref:env:PEER_BAIJING_TOKEN"
        }
      }
    }
  }
}
```

| 字段 | 说明 |
|------|------|
| `sharedSecret` | 组织内所有节点共用同一个密钥，建议通过环境变量注入 |
| `meshToken` | **必填（握手模式）**。本机 gateway 的认证令牌，用于响应远端 peer 发来的消息。对应 `openclaw gateway call --token` 的值，建议用最小权限 token 并通过 `ref:env:` 注入，不要硬编码 |
| `allowAgents` | 可选白名单，限制远端 peer 只能向指定 agentId 发消息。不配置时不限制。推荐至少填 `["main"]` |
| `port` | 对方 gateway 端口，默认 `18789` |
| `discovery.interval` | 节点发现刷新间隔 |
| `discovery.probe` | 是否主动探测 `/health` 确认节点在线 |
| `peers` | Phase 2 手动配置已知节点，Phase 3 自动握手后可省略 |

## 要求

- OpenClaw >= 2026.5.0
- Tailscale 已安装并加入同一 tailnet
- 各节点 gateway 开启 `gateway.tailscale.mode = serve`

## 安全说明

**关于 HTTP vs HTTPS**：peer 配置中使用 `http://100.64.x.x:18789/` 格式的 Tailscale IP 地址。虽然 URL scheme 为 HTTP，但 Tailscale 使用 WireGuard 在网络层对所有 tailnet 流量进行端到端加密，传输本身是安全的。若 gateway 开启了 `tailscale.mode = serve`，也可使用 HTTPS URL。**请勿将 peer URL 指向非 tailnet 地址。**

**关于 token 范围**：握手协议（`/mesh/hello`）返回的是随机 session token，不是 gateway 主令牌。session token 在服务端跟踪，有效期 1 小时，期间可重复使用；到期后自动失效。对方节点凭此 token 调用本节点的 `/mesh/send` 代理端点，gateway 主令牌始终不离开本机。

**使用前提**：仅在可信的私有 Tailscale tailnet 内使用，不要将 `/mesh/hello` 或 `/mesh/send` 端点暴露到公网。
