import { and, asc, desc, eq, gt, lt, sql } from 'drizzle-orm';

type Dialect = 'sqlite' | 'pg';

export interface LeaderboardEntry {
  boardId: string;
  userId: string;
  season: string;
  score: number;
  createdAt: Date;
}

export class LeaderboardsService {
  constructor(
    private db: any,
    private leaderboards: any,
    private entries: any,
    private dialect: Dialect,
  ) {}

  /**
   * Idempotently register a leaderboard with the given id (and optional display name).
   */
  async ensure(boardId: string, name?: string): Promise<void> {
    await this.db
      .insert(this.leaderboards)
      .values({ id: boardId, name: name ?? boardId })
      .onConflictDoNothing();
  }

  /**
   * Submit a score. Keep-best semantics: only updates if the new score is higher.
   */
  async submit(
    boardId: string,
    userId: string,
    score: number,
    season = 'global',
  ): Promise<void> {
    // GREATEST(a, b) is pg-only; sqlite uses max(a, b) as a scalar.
    const keepBest = this.dialect === 'pg'
      ? sql`GREATEST(${this.entries.score}, EXCLUDED.score)`
      : sql`max(${this.entries.score}, excluded.score)`;

    await this.db
      .insert(this.entries)
      .values({ boardId, userId, score, season, createdAt: new Date() })
      .onConflictDoUpdate({
        target: [this.entries.boardId, this.entries.userId, this.entries.season],
        set: { score: keepBest, createdAt: new Date() },
      });
  }

  /**
   * Top N entries on the board, sorted by score DESC.
   */
  async top(boardId: string, n = 10, season = 'global'): Promise<LeaderboardEntry[]> {
    return await this.db
      .select()
      .from(this.entries)
      .where(and(eq(this.entries.boardId, boardId), eq(this.entries.season, season)))
      .orderBy(desc(this.entries.score))
      .limit(n);
  }

  /**
   * The user's row plus N entries above and N below them on the board.
   * Returns [] if the user has no entry on this board/season.
   */
  async aroundMe(
    boardId: string,
    userId: string,
    n = 5,
    season = 'global',
  ): Promise<LeaderboardEntry[]> {
    const me = await this.db
      .select()
      .from(this.entries)
      .where(and(
        eq(this.entries.boardId, boardId),
        eq(this.entries.userId, userId),
        eq(this.entries.season, season),
      ))
      .limit(1);

    if (!me[0]) { return []; }
    const myScore = me[0].score;

    const above = await this.db
      .select()
      .from(this.entries)
      .where(and(
        eq(this.entries.boardId, boardId),
        eq(this.entries.season, season),
        gt(this.entries.score, myScore),
      ))
      .orderBy(asc(this.entries.score))
      .limit(n);

    const below = await this.db
      .select()
      .from(this.entries)
      .where(and(
        eq(this.entries.boardId, boardId),
        eq(this.entries.season, season),
        lt(this.entries.score, myScore),
      ))
      .orderBy(desc(this.entries.score))
      .limit(n);

    return [...above.reverse(), me[0], ...below];
  }
}
