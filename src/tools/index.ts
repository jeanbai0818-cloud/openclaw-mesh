import { Type, type Static } from "typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { PeerStore } from "../store/index.js";
import type { Router } from "../router/index.js";

const MeshSendSchema = Type.Object({
  target: Type.String({ description: "Peer hostname or IP address" }),
  agentId: Type.String({ description: "Target agent ID on the remote peer" }),
  message: Type.String({ description: "Message to send to the remote agent" }),
  sessionKey: Type.Optional(Type.String({ description: "Session key to use on the remote peer" })),
  timeoutMs: Type.Optional(Type.Number({ description: "Timeout in milliseconds (default: 30000)" })),
});

type MeshSendParams = Static<typeof MeshSendSchema>;

export function registerMeshTools(
  api: OpenClawPluginApi,
  store: PeerStore,
  router: Router,
): void {
  api.registerTool({
    name: "mesh_peers",
    label: "List mesh peers",
    description: "List currently known openclaw nodes in the Tailscale tailnet",
    parameters: Type.Object({}),
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
    parameters: MeshSendSchema,
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
