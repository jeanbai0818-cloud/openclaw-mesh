import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { meshConfigSchema, type MeshConfig } from "./src/types/index.js";
import { createPeerStore } from "./src/store/index.js";
import { createHandshakeManager } from "./src/handshake/index.js";
import { createRouter } from "./src/router/index.js";
import { startDiscovery } from "./src/discovery/index.js";
import { registerMeshHttpRoutes } from "./src/http/index.js";
import { registerMeshTools } from "./src/tools/index.js";

// Required env vars (supplied via openclaw ref:env: config references):
//   MESH_SECRET          — shared HMAC secret, same on every mesh node
//   MESH_GATEWAY_TOKEN   — local gateway auth token for proxying mesh calls
const _ENV_MESH_SECRET: string | undefined = process.env["MESH_SECRET"];
const _ENV_MESH_GATEWAY_TOKEN: string | undefined = process.env["MESH_GATEWAY_TOKEN"];
void _ENV_MESH_SECRET;
void _ENV_MESH_GATEWAY_TOKEN;

export default definePluginEntry({
  id: "openclaw-mesh",
  name: "OpenClaw Mesh",
  description: "Tailscale tailnet 内多 gateway 互联，agent 跨节点发消息",
  configSchema: meshConfigSchema,
  register(api) {
    const meshConfig = (api.pluginConfig ?? { port: 18789 }) as unknown as MeshConfig;
    const peerCount = Object.keys(meshConfig.peers ?? {}).length;
    const interval = meshConfig.discovery?.interval ?? "60s";
    api.logger.info(`[mesh] init: port=${meshConfig.port}, manual_peers=${peerCount}, discovery_interval=${interval}`);
    const store = createPeerStore();
    const handshakeManager = createHandshakeManager();
    const router = createRouter(store, meshConfig, api.logger, handshakeManager);
    startDiscovery(store, api.logger, meshConfig);
    registerMeshHttpRoutes(api, handshakeManager, meshConfig);
    registerMeshTools(api, store, router);
  },
});
