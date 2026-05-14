import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hostname as getHostname } from "node:os";
import { randomUUID } from "node:crypto";
import type { PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import type { MeshConfig, MeshSendBody, Peer, Result } from "../types/index.js";
import { ok, err } from "../types/index.js";
import type { PeerStore } from "../store/index.js";
import type { HandshakeManager } from "../handshake/index.js";

const execFileAsync = promisify(execFile);

export interface SendParams {
  target: string;
  agentId: string;
  message: string;
  sessionKey?: string;
  timeoutMs?: number;
}

export interface Router {
  send(params: SendParams): Promise<Result<string>>;
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

async function callGateway(
  url: string,
  token: string,
  params: SendParams,
  logger: PluginLogger,
): Promise<Result<string>> {
  const timeoutMs = params.timeoutMs ?? 30_000;
  const callParams: Record<string, unknown> = {
    agentId: params.agentId,
    message: params.message,
    idempotencyKey: randomUUID(),
  };
  if (params.sessionKey) callParams["sessionKey"] = params.sessionKey;

  const args = [
    "gateway", "call",
    "--url", url,
    "--token", token,
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
    return ok(extractReply(stdout));
  } catch (e) {
    const exitCode = (e as { code?: number }).code;
    logger.warn(`[mesh] gateway call to ${url} failed (exit ${exitCode ?? "unknown"})`);
    return err(`gateway call failed (exit ${exitCode ?? "unknown"})`);
  }
}

async function callMeshSend(
  url: string,
  sessionToken: string,
  params: SendParams,
  logger: PluginLogger,
): Promise<Result<string>> {
  const body: MeshSendBody = {
    sessionToken,
    agentId: params.agentId,
    message: params.message,
    timeoutMs: params.timeoutMs,
    ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
  };

  try {
    const res = await fetch(`${url}mesh/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout((params.timeoutMs ?? 30_000) + 5_000),
    });
    if (!res.ok) {
      return err(`mesh/send failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as { reply: string };
    return ok(data.reply ?? "");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn(`[mesh] mesh/send to ${url} failed: ${msg}`);
    return err(`mesh/send failed: ${msg}`);
  }
}

function isSessionValid(peer: Peer): boolean {
  return (
    typeof peer.sessionToken === "string" &&
    typeof peer.sessionExpiresAt === "number" &&
    peer.sessionExpiresAt > Date.now() + 60_000
  );
}

export function createRouter(
  store: PeerStore,
  meshConfig: MeshConfig,
  logger: PluginLogger,
  handshakeManager?: HandshakeManager,
): Router {
  const selfNodeId = getHostname();

  return {
    async send(params) {
      const directManual = meshConfig.peers?.[params.target];
      if (directManual?.token) {
        return callGateway(directManual.url, directManual.token, params, logger);
      }

      const peer = store.resolve(params.target);
      if (!peer) {
        logger.warn(`[mesh] peer not found: ${params.target}`);
        return err(`peer not found: ${params.target}`);
      }

      const manualPeer = meshConfig.peers?.[peer.hostname];
      if (manualPeer?.token) {
        return callGateway(peer.url, manualPeer.token, params, logger);
      }

      if (isSessionValid(peer)) {
        const token = peer.sessionToken as string;
        const expiresAt = peer.sessionExpiresAt as number;
        if (expiresAt < Date.now() + 120_000 && handshakeManager) {
          void renewSession(peer.hostname, peer.url, selfNodeId, meshConfig.sharedSecret, store, handshakeManager, logger);
        }
        return callMeshSend(peer.url, token, params, logger);
      }

      if (handshakeManager) {
        const handshakeResult = await handshakeManager.performHandshake(
          peer.url,
          selfNodeId,
          meshConfig.sharedSecret,
        );
        if (!handshakeResult.ok) {
          return err(`handshake failed for ${peer.hostname}: ${handshakeResult.error}`);
        }
        const { sessionToken, expiresAt } = handshakeResult.value;
        store.setSessionToken(peer.hostname, sessionToken, expiresAt);
        return callMeshSend(peer.url, sessionToken, params, logger);
      }

      return err(`no credential available for peer: ${peer.hostname}`);
    },
  };
}

async function renewSession(
  hostname: string,
  url: string,
  selfNodeId: string,
  sharedSecret: string | undefined,
  store: PeerStore,
  handshakeManager: HandshakeManager,
  logger: PluginLogger,
): Promise<void> {
  const result = await handshakeManager.performHandshake(url, selfNodeId, sharedSecret);
  if (result.ok) {
    store.setSessionToken(hostname, result.value.sessionToken, result.value.expiresAt);
  } else {
    logger.warn(`[mesh] session renewal failed for ${hostname}: ${result.error}`);
  }
}
