/**
 * AnalyticsPlugin — auto-tracks Colyseus room lifecycle events into the
 * GameDatabase analytics store. Each fired event becomes a row in the
 * `analyticsEvents` table, readable via `db.drizzle` or surfaced on the
 * admin dashboard.
 *
 * Wiring example (inside a Room subclass):
 *
 *   plugins = definePlugins({
 *     analytics: new AnalyticsPlugin({
 *       database,
 *       prefix: 'arena',
 *       track: ['join', 'leave', 'dispose'],
 *     }),
 *   });
 *
 *   onSomethingCustom() {
 *     this.plugins.analytics.track('round_started', { round: 1 });
 *   }
 */
import { RoomPlugin, type Client } from '@colyseus/core';
import type { GameDatabase } from '../GameDatabase.ts';
import { defaultUserId, type UserIdResolver } from './_shared.ts';

export type AnalyticsLifecycleEvent = 'create' | 'join' | 'leave' | 'dispose';

export interface AnalyticsPluginOptions {
  /** GameDatabase instance — supplies the underlying analytics service. */
  database: GameDatabase;

  /**
   * Prefix applied to every emitted event name. `prefix = 'arena'` turns
   * the auto-tracked `join` event into `arena.join` and the custom
   * `track('round_started', ...)` call into `arena.round_started`. Empty
   * by default (events use bare names).
   */
  prefix?: string;

  /**
   * Which lifecycle events to auto-track. Default: all four. Pass `[]`
   * to disable auto-tracking entirely and use the plugin only for
   * manual `track(...)` calls.
   */
  track?: ReadonlyArray<AnalyticsLifecycleEvent>;

  /**
   * Custom resolver for `userId`. Default reads `client.userId` then
   * `client.auth.id`. Returning null/undefined means the event is
   * tracked without a userId attached.
   */
  resolveUserId?: UserIdResolver;
}

const ALL_LIFECYCLE: ReadonlyArray<AnalyticsLifecycleEvent> = ['create', 'join', 'leave', 'dispose'];

export class AnalyticsPlugin extends RoomPlugin {
  readonly pluginName = 'analytics' as const;

  private readonly database: GameDatabase;
  private readonly prefix: string;
  private readonly trackSet: ReadonlySet<AnalyticsLifecycleEvent>;
  private readonly resolveUserId: UserIdResolver;

  constructor(opts: AnalyticsPluginOptions) {
    super();
    this.database = opts.database;
    this.prefix = opts.prefix ? `${opts.prefix}.` : '';
    this.trackSet = new Set(opts.track ?? ALL_LIFECYCLE);
    this.resolveUserId = opts.resolveUserId ?? defaultUserId;
  }

  protected async onCreate(options: any) {
    if (!this.trackSet.has('create')) { return; }
    await this.database.analytics.track(`${this.prefix}create`, null, {
      roomId: this.room.roomId,
      options,
    });
  }

  protected async onJoin(client: Client) {
    if (!this.trackSet.has('join')) { return; }
    await this.database.analytics.track(`${this.prefix}join`, this.resolveUserId(client) ?? null, {
      roomId: this.room.roomId,
    });
  }

  protected async onLeave(client: Client, code?: number) {
    if (!this.trackSet.has('leave')) { return; }
    await this.database.analytics.track(`${this.prefix}leave`, this.resolveUserId(client) ?? null, {
      roomId: this.room.roomId,
      code,
    });
  }

  protected async onDispose() {
    if (!this.trackSet.has('dispose')) { return; }
    await this.database.analytics.track(`${this.prefix}dispose`, null, {
      roomId: this.room.roomId,
    });
  }

  /**
   * Track a custom event from inside the room. The prefix is applied
   * automatically — pass `'round_started'` and the stored event name
   * becomes `'<prefix>.round_started'`.
   */
  async track(eventName: string, props?: Record<string, unknown>, userId: string | null = null) {
    await this.database.analytics.track(`${this.prefix}${eventName}`, userId, props);
  }
}
