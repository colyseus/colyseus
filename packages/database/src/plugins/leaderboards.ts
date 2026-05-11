/**
 * LeaderboardsPlugin — submits a per-client score to a configured board
 * automatically at room dispose (end-of-match). Game code supplies the
 * `score(room, client)` extractor; the plugin handles the rest.
 *
 *   plugins = definePlugins({
 *     ranked: new LeaderboardsPlugin<this>({
 *       database,
 *       boardId: 'arena_ranked',
 *       boardName: 'Ranked Arena',
 *       season: 'global',
 *       submitOn: 'dispose',
 *       score: (room, client) => room.state.scores.get(client.sessionId) ?? 0,
 *     }),
 *   });
 *
 *   // Manual submission from anywhere in the room:
 *   onPlayerScored(client) {
 *     this.plugins.ranked.submitScore(client, 100);
 *   }
 */
import { RoomPlugin, type Client, type Room } from '@colyseus/core';
import type { GameDatabase } from '../GameDatabase.ts';
import { defaultUserId, type UserIdResolver } from './_shared.ts';

export interface LeaderboardsPluginOptions<This extends Room> {
  database: GameDatabase;

  /** Board identifier (used by `db.leaderboards.submit`). */
  boardId: string;

  /**
   * Display name for the board — surfaces in the admin panel. Defaults
   * to `boardId`. Ensured at `onCreate` (idempotent insert).
   */
  boardName?: string;

  /** Season key — same one `db.leaderboards.submit` accepts. Default `'global'`. */
  season?: string;

  /**
   * When to auto-submit:
   *   - 'dispose' (default): submit every connected client's score on
   *     room dispose. The natural "end-of-match" trigger.
   *   - 'none': don't auto-submit; use `submitScore(client, score)` for
   *     explicit control.
   */
  submitOn?: 'dispose' | 'none';

  /**
   * Extract the score for a given client. Required when `submitOn ===
   * 'dispose'`. Receives the host room and the client; returning
   * `null`/`undefined` skips that client (don't submit a partial score).
   */
  score?: (room: This, client: Client) => number | null | undefined;

  /** Custom userId resolver. Default reads `client.userId` / `client.auth.id`. */
  resolveUserId?: UserIdResolver;
}

export class LeaderboardsPlugin<This extends Room = Room> extends RoomPlugin<This> {
  private readonly database: GameDatabase;
  private readonly boardId: string;
  private readonly boardName: string;
  private readonly season: string;
  private readonly submitOn: 'dispose' | 'none';
  private readonly score?: (room: This, client: Client) => number | null | undefined;
  private readonly resolveUserId: UserIdResolver;

  constructor(opts: LeaderboardsPluginOptions<This>) {
    super();
    this.database = opts.database;
    this.boardId = opts.boardId;
    this.boardName = opts.boardName ?? opts.boardId;
    this.season = opts.season ?? 'global';
    this.submitOn = opts.submitOn ?? 'dispose';
    this.score = opts.score;
    this.resolveUserId = opts.resolveUserId ?? defaultUserId;
  }

  async onCreate() {
    // Idempotent — re-running with the same boardId is a no-op (drizzle
    // .onConflictDoNothing() inside the service).
    await this.database.leaderboards.ensure(this.boardId, this.boardName);
  }

  async onDispose() {
    if (this.submitOn !== 'dispose' || !this.score) { return; }
    // Iterate connected clients and submit each. The service uses
    // keep-best semantics, so partial mid-match submissions (e.g. via
    // `submitScore`) aren't downgraded by a lower end-of-match score.
    for (const client of this.room.clients) {
      const userId = this.resolveUserId(client);
      if (!userId) { continue; }
      const value = this.score(this.room, client);
      if (typeof value !== 'number') { continue; }
      await this.database.leaderboards.submit(this.boardId, userId, value, this.season);
    }
  }

  /**
   * Submit a score for a specific client. Use mid-match for events the
   * plugin's auto-flow doesn't cover (e.g. "first blood" bonus).
   */
  async submitScore(client: Client, score: number) {
    const userId = this.resolveUserId(client);
    if (!userId) { return; }
    await this.database.leaderboards.submit(this.boardId, userId, score, this.season);
  }

  /**
   * Read the top N entries from this board. Convenience over directly
   * reaching for `database.leaderboards.top(boardId, n, season)`.
   */
  async top(n = 10) {
    return this.database.leaderboards.top(this.boardId, n, this.season);
  }

  /**
   * Read this client's standing relative to nearby ranks.
   */
  async aroundClient(client: Client, n = 5) {
    const userId = this.resolveUserId(client);
    if (!userId) { return []; }
    return this.database.leaderboards.aroundMe(this.boardId, userId, n, this.season);
  }
}
