import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { HandshakeBody, MeshConfig, MeshSendBody } from "../types/index.js";
import type { HandshakeManager } from "../handshake/index.js";

const execFileAsync = promisify(execFile);

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

function extractReply(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed["text"] === "string") return parsed["text"];
    if (typeof parsed["reply"] === "string") return parsed["reply"];
    const content = parsed["content"];
    if (Array.isArray(content)) {
      const texts = content
        .filter((c): c is { type: string; text: string } => typeof (c as { text?: unknown }).text === "string")
        .map((c) => c.text);
      if (texts.length > 0) return texts.join("\n");
    }
    return raw.trim();
  } catch {
    return raw.trim();
  }
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

      const response = handshakeManager.issueToken(meshToken, body.nodeId);
      sendJson(res, 200, response);
    },
  });

  api.registerHttpRoute({
    path: "/mesh/send",
    auth: "plugin",
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method Not Allowed" });
        return;
      }

      let body: MeshSendBody;
      try {
        const raw = await readBody(req);
        body = JSON.parse(raw) as MeshSendBody;
      } catch {
        sendJson(res, 400, { error: "invalid JSON body" });
        return;
      }

      const session = handshakeManager.lookupSession(body.sessionToken);
      if (!session) {
        sendJson(res, 401, { error: "invalid or expired session token" });
        return;
      }

      const allowAgents = meshConfig.allowAgents;
      if (!allowAgents || allowAgents.length === 0 || !allowAgents.includes(body.agentId)) {
        sendJson(res, 403, { error: `agent not in allowlist: ${body.agentId}` });
        return;
      }

      const port = meshConfig.port ?? 18789;
      const localUrl = `http://localhost:${port}/`;
      const MAX_TIMEOUT_MS = 120_000;
      const timeoutMs = Math.min(body.timeoutMs ?? 30_000, MAX_TIMEOUT_MS);
      const callParams: Record<string, unknown> = {
        agentId: body.agentId,
        message: body.message,
        idempotencyKey: randomUUID(),
      };
      if (body.sessionKey) callParams["sessionKey"] = body.sessionKey;

      const args = [
        "gateway", "call",
        "--url", localUrl,
        "--token", session.meshToken,
        "--timeout", String(timeoutMs),
        "--expect-final",
        "--json",
        "agent",
        "--params", JSON.stringify(callParams),
      ];

      try {
        const { stdout } = await execFileAsync("openclaw", args, {
          timeout: timeoutMs + 5_000,
        });
        sendJson(res, 200, { reply: extractReply(stdout) });
      } catch (e) {
        const exitCode = (e as { code?: number }).code;
        sendJson(res, 502, { error: `gateway call failed (exit ${exitCode ?? "unknown"})` });
      }
    },
  });
}
