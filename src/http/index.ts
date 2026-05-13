import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { HandshakeBody, MeshConfig } from "../types/index.js";
import type { HandshakeManager } from "../handshake/index.js";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

export function registerMeshHttpRoutes(
  api: OpenClawPluginApi,
  handshakeManager: HandshakeManager,
  meshConfig: MeshConfig,
): void {
  api.registerHttpRoute({
    path: "/mesh/hello",
    auth: "plugin",
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method Not Allowed" });
        return;
      }

      const sharedSecret = meshConfig.sharedSecret;
      const meshToken = meshConfig.meshToken;

      if (!sharedSecret) {
        sendJson(res, 500, { error: "sharedSecret not configured" });
        return;
      }
      if (!meshToken) {
        sendJson(res, 500, { error: "meshToken not configured" });
        return;
      }

      let body: HandshakeBody;
      try {
        const raw = await readBody(req);
        body = JSON.parse(raw) as HandshakeBody;
      } catch {
        sendJson(res, 400, { error: "invalid JSON body" });
        return;
      }

      if (!handshakeManager.verifyIncoming(body, sharedSecret)) {
        sendJson(res, 401, { error: "invalid handshake signature or timestamp" });
        return;
      }

      const response = handshakeManager.issueToken(meshToken);
      sendJson(res, 200, response);
    },
  });
}
