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
      "port": 18789,
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
| `port` | 对方 gateway 端口，默认 `18789` |
| `discovery.interval` | 节点发现刷新间隔 |
| `discovery.probe` | 是否主动探测 `/health` 确认节点在线 |
| `peers` | Phase 2 手动配置已知节点，Phase 3 自动握手后可省略 |

## 要求

- OpenClaw >= 2026.5.0
- Tailscale 已安装并加入同一 tailnet
- 各节点 gateway 开启 `gateway.tailscale.mode = serve`
