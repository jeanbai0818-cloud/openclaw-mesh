import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { meshConfigSchema } from "./src/types/index.js";
import { createPeerStore } from "./src/store/index.js";
import { createRouter } from "./src/router/index.js";
import { startDiscovery } from "./src/discovery/index.js";
import { registerMeshHttpRoutes } from "./src/http/index.js";
import { registerMeshTools } from "./src/tools/index.js";

export default {
  id: "openclaw-mesh",
  configSchema: meshConfigSchema,
  register(api: OpenClawPluginApi) {
    const store  = createPeerStore();
    const router = createRouter(store, api.runtime);
    startDiscovery(store, api.config, api.log);
    registerMeshHttpRoutes(api, store);
    registerMeshTools(api, router);
  },
};
