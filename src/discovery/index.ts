import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import type { MeshConfig, Peer } from "../types/index.js";
import type { PeerStore } from "../store/index.js";

const execFileAsync = promisify(execFile);

function resolveTailscaleBin(): string {
  return process.platform === "darwin"
    ? "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
    : "tailscale";
}

function parseIntervalMs(s: string): number {
  const match = s.match(/^(\d+)(ms|m|s)?$/);
  if (!match) return 60_000;
  const n = parseInt(match[1], 10);
  const unit = match[2] ?? "ms";
  if (unit === "m") return n * 60_000;
  if (unit === "s") return n * 1_000;
  return n;
}

interface TailscaleStatusPeer {
  HostName?: string;
  TailscaleIPs?: string[];
  Online?: boolean;
}

interface TailscaleStatus {
  Peer?: Record<string, TailscaleStatusPeer>;
}

async function probePeer(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}health`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function runDiscoveryCycle(
  store: PeerStore,
  logger: PluginLogger,
  config: MeshConfig,
): Promise<void> {
  const bin = resolveTailscaleBin();
  const port = config.port ?? 18789;
  const probe = config.discovery?.probe !== false;

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(bin, ["status", "--json"]));
  } catch (e) {
    logger.warn(`[mesh] tailscale status failed: ${String(e)}`);
    return;
  }

  let status: TailscaleStatus;
  try {
    status = JSON.parse(stdout) as TailscaleStatus;
  } catch {
    logger.warn("[mesh] failed to parse tailscale status JSON");
    return;
  }

  const peers = status.Peer ?? {};
  await Promise.all(
    Object.values(peers).map(async (entry) => {
      const hostname = (entry.HostName ?? "").toLowerCase();
      const ip = entry.TailscaleIPs?.[0] ?? "";
      if (!hostname || !ip) return;

      const url = `http://${ip}:${port}/`;
      const online = probe ? await probePeer(url) : (entry.Online === true);

      const peer: Peer = {
        hostname,
        ip,
        url,
        online,
        lastSeen: Date.now(),
      };
      store.upsert(peer);
    }),
  );
}

export function startDiscovery(
  store: PeerStore,
  logger: PluginLogger,
  config: MeshConfig,
): void {
  const interval = parseIntervalMs(config.discovery?.interval ?? "60s");

  void (async () => {
    await runDiscoveryCycle(store, logger, config);
  })();

  setInterval(() => {
    void runDiscoveryCycle(store, logger, config);
  }, interval);
}
