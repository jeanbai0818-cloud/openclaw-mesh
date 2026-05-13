import type { Peer } from "../types/index.js";

export interface PeerStore {
  upsert(peer: Peer): void;
  resolve(target: string): Peer | undefined;
  list(): Peer[];
  setSessionToken(hostname: string, token: string, expiresAt: number): void;
}

export function createPeerStore(): PeerStore {
  const byHostname = new Map<string, Peer>();
  const byIp = new Map<string, Peer>();

  return {
    upsert(peer) {
      const normalized = { ...peer, hostname: peer.hostname.toLowerCase() };
      byHostname.set(normalized.hostname, normalized);
      byIp.set(normalized.ip, normalized);
    },

    resolve(target) {
      return byHostname.get(target.toLowerCase()) ?? byIp.get(target);
    },

    list() {
      return [...byHostname.values()];
    },

    setSessionToken(hostname, token, expiresAt) {
      const peer = byHostname.get(hostname.toLowerCase());
      if (peer) {
        peer.sessionToken = token;
        peer.sessionExpiresAt = expiresAt;
      }
    },
  };
}
