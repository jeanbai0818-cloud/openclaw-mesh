import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import type { HandshakeBody, HandshakeResponse, Result } from "../types/index.js";
import { ok, err } from "../types/index.js";

interface Session {
  nodeId: string;
  meshToken: string;
  expiresAt: number;
}

function generateHmac(sharedSecret: string, nodeId: string, timestamp: number): string {
  return createHmac("sha256", sharedSecret)
    .update(`${nodeId}:${timestamp}`)
    .digest("hex");
}

function verifyHmac(sharedSecret: string, nodeId: string, timestamp: number, hmac: string): boolean {
  const expected = generateHmac(sharedSecret, nodeId, timestamp);
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(hmac, "hex"));
  } catch {
    return false;
  }
}

function isTimestampValid(timestamp: number): boolean {
  return Math.abs(Date.now() / 1000 - timestamp) <= 300;
}

export interface HandshakeManager {
  verifyIncoming(body: HandshakeBody, sharedSecret: string): boolean;
  issueToken(meshToken: string, nodeId: string): HandshakeResponse;
  lookupSession(sessionToken: string): { nodeId: string; meshToken: string } | null;
  performHandshake(
    targetUrl: string,
    selfNodeId: string,
    sharedSecret: string,
  ): Promise<Result<HandshakeResponse>>;
}

export function createHandshakeManager(): HandshakeManager {
  const sessions = new Map<string, Session>();

  return {
    verifyIncoming(body, sharedSecret) {
      if (!isTimestampValid(body.timestamp)) return false;
      return verifyHmac(sharedSecret, body.nodeId, body.timestamp, body.hmac);
    },

    issueToken(meshToken, nodeId) {
      const sessionToken = randomUUID();
      const expiresAt = Date.now() + 3_600_000;
      sessions.set(sessionToken, { nodeId, meshToken, expiresAt });
      return { sessionToken, expiresAt };
    },

    lookupSession(sessionToken) {
      const s = sessions.get(sessionToken);
      if (!s) return null;
      if (s.expiresAt <= Date.now()) {
        sessions.delete(sessionToken);
        return null;
      }
      return { nodeId: s.nodeId, meshToken: s.meshToken };
    },

    async performHandshake(targetUrl, selfNodeId, sharedSecret) {
      const timestamp = Math.floor(Date.now() / 1000);
      const hmac = generateHmac(sharedSecret, selfNodeId, timestamp);
      const body: HandshakeBody = { nodeId: selfNodeId, timestamp, hmac };

      try {
        const res = await fetch(`${targetUrl}mesh/hello`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          return err(`handshake failed: HTTP ${res.status}`);
        }
        const data = (await res.json()) as HandshakeResponse;
        if (!data.sessionToken) {
          return err("handshake response missing sessionToken");
        }
        return ok(data);
      } catch (e) {
        return err(`handshake error: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };
}
