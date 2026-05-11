/**
 * CloudSavesPlugin — auto-load on join, auto-save on leave.
 *
 * The plugin is intentionally minimal: room authors supply two callbacks
 * (`apply` for load, `payload` for save) that bridge between the
 * plugin's stored shape and the room's state. This keeps the plugin
 * agnostic to whatever shape your players/saves take, without
 * sacrificing the auto-wiring win.
 *
 *   plugins = definePlugins({
 *     saves: new CloudSavesPlugin<this>({
 *       database,
 *       slot: 0,
 *       onJoin: 'load',
 *       onLeave: 'save',
 *       payload: (room, client) => room.state.players.get(client.sessionId).serialize(),
 *       apply:   (room, client, data) => room.state.players.get(client.sessionId).restore(data),
 *     }),
 *   });
 */
import { RoomPlugin, type Client, type Room } from '@colyseus/core';
import type { GameDatabase } from '../GameDatabase.ts';
import { defaultUserId, type UserIdResolver } from './_shared.ts';

export interface CloudSavesPluginOptions<This extends Room> {
  database: GameDatabase;

  /** Save slot index. Default 0. */
  slot?: number;

  /**
   * onJoin behavior:
   *   - 'load' (default): fetch the user's saved payload + call `apply`
   *   - 'none':           skip; use `manualLoad(client)` for explicit control
   */
  onJoin?: 'load' | 'none';

  /**
   * onLeave behavior:
   *   - 'save' (default): call `payload` + persist
   *   - 'none':           skip; use `manualSave(client)` for explicit control
   */
  onLeave?: 'save' | 'none';

  /**
   * Build the payload to persist. Required when `onLeave === 'save'`
   * (or when calling `manualSave`). Receives the host room and the
   * leaving client.
   */
  payload?: (room: This, client: Client) => unknown;

  /**
   * Apply a loaded payload to the room. Required when `onJoin === 'load'`
   * (or when calling `manualLoad`). Receives the host room, the joining
   * client, and the deserialized payload.
   */
  apply?: (room: This, client: Client, payload: unknown) => void;

  /** Custom userId resolver. Default reads `client.userId` / `client.auth.id`. */
  resolveUserId?: UserIdResolver;
}

export class CloudSavesPlugin<This extends Room = Room> extends RoomPlugin<This> {
  private readonly database: GameDatabase;
  private readonly slot: number;
  private readonly onJoinMode: 'load' | 'none';
  private readonly onLeaveMode: 'save' | 'none';
  private readonly payload?: (room: This, client: Client) => unknown;
  private readonly apply?: (room: This, client: Client, payload: unknown) => void;
  private readonly resolveUserId: UserIdResolver;

  constructor(opts: CloudSavesPluginOptions<This>) {
    super();
    this.database = opts.database;
    this.slot = opts.slot ?? 0;
    this.onJoinMode = opts.onJoin ?? 'load';
    this.onLeaveMode = opts.onLeave ?? 'save';
    this.payload = opts.payload;
    this.apply = opts.apply;
    this.resolveUserId = opts.resolveUserId ?? defaultUserId;
  }

  async onJoin(client: Client) {
    if (this.onJoinMode !== 'load') { return; }
    await this.loadFor(client);
  }

  async onLeave(client: Client) {
    if (this.onLeaveMode !== 'save') { return; }
    await this.saveFor(client);
  }

  /**
   * Force a load for `client`, regardless of `onJoin` mode. Useful for
   * explicit reload triggers (e.g. an admin tool requesting a re-sync).
   * No-op (with a debug-friendly return) if no `apply` callback is set.
   */
  async manualLoad(client: Client) {
    await this.loadFor(client);
  }

  /**
   * Force a save for `client`, regardless of `onLeave` mode. Useful for
   * checkpointing mid-match or persisting on critical events.
   */
  async manualSave(client: Client) {
    await this.saveFor(client);
  }

  private async loadFor(client: Client) {
    if (!this.apply) { return; }
    const userId = this.resolveUserId(client);
    if (!userId) { return; }
    const saved = await this.database.saves.load(userId, this.slot);
    if (!saved) { return; }
    this.apply(this.room, client, saved.data);
  }

  private async saveFor(client: Client) {
    if (!this.payload) { return; }
    const userId = this.resolveUserId(client);
    if (!userId) { return; }
    const data = this.payload(this.room, client);
    await this.database.saves.save(userId, this.slot, data);
  }
}
