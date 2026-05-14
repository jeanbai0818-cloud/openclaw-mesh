import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { PeerStore } from "../store/index.js";
import type { Router } from "../router/index.js";

type MeshSendParams = {
  target: string;
  agentId: string;
  message: string;
  sessionKey?: string;
  timeoutMs?: number;
};

const meshSendSchema = {
  type: "object",
  properties: {
    target: { type: "string", description: "Peer hostname or IP address" },
    agentId: { type: "string", description: "Target agent ID on the remote peer" },
    message: { type: "string", description: "Message to send to the remote agent" },
    sessionKey: { type: "string", description: "Session key to use on the remote peer" },
    timeoutMs: { type: "number", description: "Timeout in milliseconds (default: 30000)" },
  },
  required: ["target", "agentId", "message"],
} as const;

export function registerMeshTools(
  api: OpenClawPluginApi,
  store: PeerStore,
  router: Router,
): void {
  api.registerTool({
    name: "mesh_peers",
    label: "List mesh peers",
    description: "List currently known openclaw nodes in the Tailscale tailnet",
    parameters: { type: "object", properties: {} } as const,
    execute: async (_toolCallId, _params) => {
      const peers = store.list().map(({ sessionToken: _st, sessionExpiresAt: _se, ...safe }) => safe);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(peers, null, 2) }],
        details: { peers },
      };
    },
  });

  api.registerTool({
    name: "mesh_send",
    label: "Send message to mesh peer",
    description: "Send a message to an agent on a remote openclaw node and wait for the reply",
    parameters: meshSendSchema,
    execute: async (_toolCallId, params: MeshSendParams) => {
      const result = await router.send(params);
      const text = result.ok ? result.value : `Error: ${result.error}`;
      return {
        content: [{ type: "text" as const, text }],
        details: { ok: result.ok },
      };
    },
  });
}
