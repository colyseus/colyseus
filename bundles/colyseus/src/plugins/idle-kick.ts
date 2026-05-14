/**
 * IdleKickPlugin — auto-disconnects clients that haven't sent a message
 * in a configurable amount of time.
 *
 * Usage:
 *
 *   import { IdleKickPlugin } from 'colyseus/plugins/idle-kick';
 *
 *   class GameRoom extends Room {
 *     plugins = definePlugins({
 *       idle: new IdleKickPlugin({ timeoutMs: 60_000 }),
 *     });
 *   }
 *
 * Footprint: one `clock.setInterval` per room, zero per-message work and
 * zero per-client state. Activity is read from `client._lastMessageTime`,
 * which the room already maintains for rate-limiting. Any inbound frame
 * (including SDK keepalive PINGs) refreshes it — by design.
 *
 * On kick, clients see WS close code 1000 ("normal closure") with the
 * reason `'kicked'` by default. The SDK treats 1000 as a final leave
 * (no auto-reconnect attempt) and forwards the reason string to
 * `room.onLeave((code, reason) => ...)`.
 */
import { RoomPlugin, type Client } from '@colyseus/core';

export interface IdleKickOptions {
  /** Milliseconds of inactivity after which a client is kicked. */
  timeoutMs: number;

  /**
   * Milliseconds between scans. Default: `min(timeoutMs / 4, 5000)`.
   * Smaller values kick sooner past the deadline; larger values reduce
   * timer wakeups. The scan itself is O(clients) with no allocations.
   */
  scanIntervalMs?: number;

  /** WS close code sent to the kicked client. Default: 1000. */
  closeCode?: number;

  /** WS close reason forwarded to the SDK's `onLeave`. Default: `'kicked'`. */
  reason?: string;

  /**
   * Optional predicate to exempt a client from being kicked (e.g.,
   * admins, spectators, currently-AFK-but-by-design). Return `true` to
   * keep the client immune.
   */
  isExempt?: (client: Client) => boolean;

  /**
   * Called just before a client is kicked. Use to log, broadcast a
   * "<player> went idle" message, or persist analytics.
   */
  onKick?: (client: Client, idleMs: number) => void;
}

export class IdleKickPlugin extends RoomPlugin {
  readonly pluginName = 'idleKick' as const;

  private timeoutMs: number;
  private scanIntervalMs: number;
  private closeCode: number;
  private reason: string;
  private isExempt?: (client: Client) => boolean;
  private onKickCb?: (client: Client, idleMs: number) => void;

  private interval?: { clear: () => void };

  constructor(opts: IdleKickOptions) {
    super();
    this.timeoutMs = opts.timeoutMs;
    this.scanIntervalMs = opts.scanIntervalMs ?? Math.min(opts.timeoutMs / 4, 5000);
    this.closeCode = opts.closeCode ?? 1000;
    this.reason = opts.reason ?? 'kicked';
    this.isExempt = opts.isExempt;
    this.onKickCb = opts.onKick;
  }

  protected onCreate() {
    this.interval = this.room.clock.setInterval(() => this.scan(), this.scanIntervalMs);
  }

  protected onJoin(client: Client) {
    // Seed `_lastMessageTime` so a client that joins and immediately goes
    // silent has a meaningful "last seen" timestamp. Without this it's 0
    // until their first inbound frame, which would look like "infinitely
    // idle" to the scan.
    (client as any)._lastMessageTime = this.room.clock.currentTime;
  }

  protected onDispose() {
    this.interval?.clear();
    this.interval = undefined;
  }

  private scan() {
    const now = this.room.clock.currentTime;
    const cutoff = now - this.timeoutMs;
    // Iterate in reverse — `kickClient` removes the client synchronously
    // from `this.room.clients` via `_forciblyCloseClient`, so going
    // backwards keeps the index valid.
    for (let i = this.room.clients.length - 1; i >= 0; i--) {
      const c = this.room.clients[i] as Client & { _lastMessageTime: number };
      if (this.isExempt?.(c)) { continue; }
      const last = c._lastMessageTime;
      if (last <= cutoff) {
        this.onKickCb?.(c, now - last);
        this.room.kickClient(c.sessionId, this.closeCode, this.reason);
      }
    }
  }
}
