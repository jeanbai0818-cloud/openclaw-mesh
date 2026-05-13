import type { OpenClawPluginConfigSchema } from "openclaw/plugin-sdk/plugin-entry";

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export interface Peer {
  hostname: string;
  ip: string;
  url: string;
  online: boolean;
  lastSeen: number;
  sessionToken?: string;
  sessionExpiresAt?: number;
}

export interface MeshConfig {
  sharedSecret?: string;
  meshToken?: string;
  port?: number;
  discovery?: { interval?: string; probe?: boolean };
  peers?: Record<string, { url: string; token: string }>;
}

export interface HandshakeBody {
  nodeId: string;
  timestamp: number;
  hmac: string;
}

export interface HandshakeResponse {
  sessionToken: string;
  expiresAt: number;
}

export interface MeshSendBody {
  sessionToken: string;
  agentId: string;
  message: string;
  sessionKey?: string;
  timeoutMs?: number;
}

export const meshConfigSchema: OpenClawPluginConfigSchema = {
  validate(value: unknown) {
    if (typeof value !== "object" || value === null) {
      return { ok: false as const, errors: ["config must be an object"] };
    }
    return { ok: true as const };
  },
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      sharedSecret: { type: "string" },
      meshToken: { type: "string" },
      port: { type: "integer" },
      discovery: {
        type: "object",
        properties: {
          interval: { type: "string" },
          probe: { type: "boolean" },
        },
      },
      peers: {
        type: "object",
        additionalProperties: {
          type: "object",
          properties: {
            url: { type: "string" },
            token: { type: "string" },
          },
          required: ["url", "token"],
        },
      },
    },
  },
};
