import { eq, sql, type InferSelectModel } from 'drizzle-orm';
import { generateId } from '@colyseus/core';
import type { AuthSettings } from '@colyseus/auth';
import type { UsersTableShape } from '../types.ts';
import type { ServiceDb } from './_db.ts';

/**
 * `T` is the user's actual users-table type. By default it's
 * `UsersTableShape` (the constraint itself, types loose to AnyColumn). When
 * a user passes their own table to GameDatabase — e.g. one with
 * `displayName` and `level` extras — `T` flows in via GameDatabase's
 * generic, and `findByEmail()` returns the full row including those
 * extras.
 */
export class AuthService<T extends UsersTableShape = UsersTableShape> {
  private db: ServiceDb;
  private users: T;

  constructor(db: ServiceDb, users: T) {
    this.db = db;
    this.users = users;
  }

  /**
   * Returns an AuthSettings-compatible object to pass to auth.routes().
   *
   *   import { auth } from '@colyseus/auth';
   *   auth.routes(db.auth.settings);
   */
  get settings(): Partial<AuthSettings> {
    return {
      onFindUserByEmail: this.findByEmail.bind(this),
      onRegisterWithEmailAndPassword: this.registerWithEmail.bind(this),
      onRegisterAnonymously: this.registerAnonymous.bind(this),
      onResetPassword: this.resetPassword.bind(this),
      onOAuthProviderCallback: this.oauthCallback.bind(this),
      onCheckBanned: this.checkBanned.bind(this),
    };
  }

  /**
   * Find user by email. Returns the user with `password` field mapped from
   * `passwordHash`, as expected by @colyseus/auth (auth.ts line 219).
   *
   * Return type includes whatever columns the user added to their custom
   * `users` table — `InferSelectModel<T>` resolves them.
   */
  private async findByEmail(email: string): Promise<(InferSelectModel<T> & { password: any }) | null> {
    const rows = await this.db
      .select()
      .from(this.users)
      .where(eq(this.users.email, email))
      .limit(1);

    if (!rows[0]) { return null; }

    const user = { ...rows[0] };
    // @colyseus/auth checks user.password — map from passwordHash
    user.password = user.passwordHash;
    // Ban gating is handled by `onCheckBanned` in @colyseus/auth's
    // /login flow (called after Hash.verify so we can return a
    // distinct 403 "banned" response). We still return the row here
    // so /register's `existingUser` check sees the email as taken
    // and refuses to create a second row.
    return user;
  }

  /**
   * Ban a user. `until` defaults to a far-future timestamp (effectively
   * permanent). The next sign-in attempt is rejected via findByEmail
   * while bannedUntil > now. The user's `tokenVersion` is incremented
   * in the same UPDATE so any JWT issued before this call is rejected
   * on its next verification — without this, a banned user could keep
   * playing on their previously-issued token until it expired.
   */
  async ban(userId: string, opts: { reason?: string; until?: Date | null } = {}): Promise<void> {
    // Permanent bans use a far-future sentinel so the same `> now()`
    // check in findByEmail handles both timed and permanent bans. Year
    // 9999 fits inside both PG's TIMESTAMP and sqlite's INTEGER (unix
    // epoch in seconds) — JS Date.MAX_VALUE overflows PG.
    const PERMANENT = new Date(Date.UTC(9999, 11, 31));
    const until = opts.until === undefined ? PERMANENT : (opts.until ?? PERMANENT);
    await this.db
      .update(this.users)
      .set({
        bannedUntil: until,
        bannedReason: opts.reason ?? null,
        tokenVersion: sql`${this.users.tokenVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(this.users.id, userId));
  }

  /**
   * Read the current token revocation counter for a user. Returns `0`
   * for unknown users.
   */
  async getTokenVersion(userId: string): Promise<number> {
    const rows = await this.db
      .select({ tv: this.users.tokenVersion })
      .from(this.users)
      .where(eq(this.users.id, userId))
      .limit(1);
    return Number(rows[0]?.tv ?? 0);
  }

  /**
   * Increment the user's token version, invalidating every JWT issued
   * before this call. Use for password changes, "sign out everywhere",
   * and forced-rotation after suspected compromise. (`ban()` bumps the
   * counter atomically; this method is for non-ban revocation.)
   */
  async bumpTokenVersion(userId: string): Promise<void> {
    await this.db
      .update(this.users)
      .set({
        tokenVersion: sql`${this.users.tokenVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(this.users.id, userId));
  }

  /**
   * Implementation of `@colyseus/auth`'s `onCheckBanned` hook. Returns
   * `{ reason, until }` when the user is actively banned, otherwise
   * `null`. The auth layer surfaces this as a distinct 403 "banned"
   * response so the client can render the right message instead of
   * "invalid_credentials".
   *
   * Reads `bannedUntil` / `bannedReason` straight off the user row
   * provided by the auth layer — no extra round-trip.
   */
  private checkBanned(user: any): { reason: string | null; until: Date } | null {
    if (!isBanned(user)) { return null; }
    const v = user.bannedUntil;
    const until = v instanceof Date ? v : new Date(v as any);
    return { reason: user.bannedReason ?? null, until };
  }

  /** Lift a ban (clears bannedUntil + bannedReason). Idempotent. */
  async unban(userId: string): Promise<void> {
    await this.db
      .update(this.users)
      .set({
        bannedUntil: null,
        bannedReason: null,
        updatedAt: new Date(),
      })
      .where(eq(this.users.id, userId));
  }

  /**
   * Current ban state for a user. Returns `{ banned: false }` for
   * unknown users — callers shouldn't lock-out missing players.
   */
  async isBanned(
    userId: string,
    at: Date = new Date(),
  ): Promise<{ banned: true; reason: string | null; until: Date } | { banned: false }> {
    const rows = await this.db
      .select({
        bannedUntil: this.users.bannedUntil,
        bannedReason: this.users.bannedReason,
      })
      .from(this.users)
      .where(eq(this.users.id, userId))
      .limit(1);
    const row = rows[0] as any;
    if (!row || !row.bannedUntil) { return { banned: false }; }
    const until = row.bannedUntil instanceof Date ? row.bannedUntil : new Date(row.bannedUntil);
    if (until.getTime() <= at.getTime()) { return { banned: false }; }
    return { banned: true, reason: row.bannedReason ?? null, until };
  }

  /**
   * Register with email and password.
   * The password is already hashed by @colyseus/auth before reaching here.
   * Handles anonymous→email upgrade via options.upgradingToken.
   */
  private async registerWithEmail(
    email: string,
    hashedPassword: string,
    options: { upgradingToken?: any },
  ) {
    // Anonymous → email upgrade
    if (options?.upgradingToken) {
      const tokenData = options.upgradingToken as any;
      const userId = tokenData.id || tokenData.anonymousId;

      if (userId) {
        await this.db
          .update(this.users)
          .set({
            email,
            passwordHash: hashedPassword,
            anonymous: false,
            updatedAt: new Date(),
          })
          .where(eq(this.users.id, userId));
        return;
      }
    }

    // Normal registration
    await this.db
      .insert(this.users)
      .values({
        id: generateId(21),
        email,
        passwordHash: hashedPassword,
        anonymous: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
  }

  /**
   * Register anonymous user. `.returning()` hands back every schema
   * column so the resulting JWT carries `tokenVersion` (admin bans can
   * then invalidate anonymous sessions) — no re-select round trip.
   */
  private async registerAnonymous(options?: any) {
    const id = generateId(21);
    const anonymousId = generateId(21);

    const [row] = await this.db.insert(this.users).values({
      id,
      anonymousId,
      anonymous: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    return { ...row, ...options };
  }

  /**
   * Reset password. The new password is already hashed by @colyseus/auth.
   */
  private async resetPassword(email: string, hashedPassword: string) {
    await this.db
      .update(this.users)
      .set({
        passwordHash: hashedPassword,
        updatedAt: new Date(),
      })
      .where(eq(this.users.email, email));
  }

  /**
   * Set a user's password hash by id (not email — used by the admin
   * panel's reset flow where the userId is carried in the reset JWT).
   * Pre-hashed input expected; pair with `@colyseus/auth`'s `Hash.make`.
   */
  async setPasswordHash(userId: string, hashedPassword: string): Promise<void> {
    await this.db
      .update(this.users)
      .set({
        passwordHash: hashedPassword,
        updatedAt: new Date(),
      })
      .where(eq(this.users.id, userId));
  }

  /**
   * OAuth provider callback. Creates or finds user based on OAuth profile.
   * Handles anonymous→OAuth upgrade via data.upgradingToken.
   */
  private async oauthCallback(data: any, provider: string) {
    const profile = data.profile || data;
    const email = profile.email || profile.email_verified;

    // Try to upgrade an existing anonymous user if a session token was
    // forwarded into the OAuth flow. The token might be stale (DB wiped,
    // user deleted, anon session from another deployment) — in that
    // case fall THROUGH to the find-by-email / create paths below
    // rather than returning null. Returning null here used to crash
    // the OAuth callback handler with jsonwebtoken's "Expected payload
    // to be a plain object", because @colyseus/auth then tried to sign
    // a null user.
    if (data.upgradingToken) {
      const tokenData = data.upgradingToken as any;
      const userId = tokenData.id || tokenData.anonymousId;

      if (userId && email) {
        const [row] = await this.db
          .update(this.users)
          .set({
            email,
            anonymous: false,
            updatedAt: new Date(),
          })
          .where(eq(this.users.id, userId))
          .returning();

        if (row) { return row; }
        // No matching row — token was stale. Continue to the fallback
        // paths so the sign-in still succeeds against the Discord email.
      }
    }

    // Find existing user by email
    if (email) {
      const rows = await this.db
        .select()
        .from(this.users)
        .where(eq(this.users.email, email))
        .limit(1);

      if (rows[0]) { return rows[0]; }
    }

    // Create new user from OAuth profile. `.returning()` carries
    // schema-defined columns (notably `tokenVersion`) into the JWT.
    const id = generateId(21);
    const [row] = await this.db.insert(this.users).values({
      id,
      email: email || null,
      anonymous: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    return row ?? null;
  }
}

/**
 * True when the row carries an active ban — `bannedUntil` is non-null
 * AND in the future. Tolerates both Date (drizzle pg / sqlite
 * timestamp_ms) and raw number (custom schemas) shapes.
 */
function isBanned(row: { bannedUntil?: Date | number | string | null }): boolean {
  const v = row.bannedUntil;
  if (v == null) { return false; }
  const t = v instanceof Date ? v.getTime() : new Date(v as any).getTime();
  return Number.isFinite(t) && t > Date.now();
}
